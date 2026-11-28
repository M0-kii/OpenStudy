use std::{
    ffi::c_void,
    ptr::{null, null_mut},
    sync::atomic::{AtomicPtr, Ordering::Relaxed},
};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Input::KeyboardAndMouse::{
            GetAsyncKeyState, VK_CONTROL, VK_DELETE, VK_ESCAPE, VK_LWIN, VK_RWIN, VK_TAB,
        },
        WindowsAndMessaging::{
            CallNextHookEx, GetForegroundWindow, SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION,
            KBDLLHOOKSTRUCT, LLKHF_ALTDOWN, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
        },
    },
};

static HOOK: AtomicPtr<c_void> = AtomicPtr::new(null_mut());
static READER: AtomicPtr<c_void> = AtomicPtr::new(null_mut());

pub fn enable(reader: HWND) {
    disable();
    // The synchronous Tauri command runs on the native event-loop thread.
    let hook =
        unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(filter), GetModuleHandleW(null()), 0) };
    if !hook.is_null() {
        READER.store(reader, Relaxed);
        HOOK.store(hook, Relaxed);
    }
}

pub fn disable() {
    READER.store(null_mut(), Relaxed);
    let hook = HOOK.swap(null_mut(), Relaxed);
    if !hook.is_null() {
        unsafe { UnhookWindowsHookEx(hook) };
    }
}

fn is_switch_chord(vk_code: u32, flags: u32, pressed: bool, control: bool, win: bool) -> bool {
    if !pressed {
        return false;
    }
    let alt = flags & LLKHF_ALTDOWN != 0;
    (vk_code == u32::from(VK_TAB) && alt && !control && !win)
        || vk_code == u32::from(VK_LWIN)
        || vk_code == u32::from(VK_RWIN)
        || (vk_code == u32::from(VK_ESCAPE) && control && !alt)
}

unsafe extern "system" fn filter(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let reader = READER.load(Relaxed);
        if !reader.is_null() && GetForegroundWindow() == reader {
            // Win32 supplies a KBDLLHOOKSTRUCT for the duration of an HC_ACTION callback.
            let event = &*(data as *const KBDLLHOOKSTRUCT);
            let pressed = matches!(message as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
            let control = GetAsyncKeyState(i32::from(VK_CONTROL)) < 0;
            let win = GetAsyncKeyState(i32::from(VK_LWIN)) < 0
                || GetAsyncKeyState(i32::from(VK_RWIN)) < 0;
            if is_switch_chord(event.vkCode, event.flags, pressed, control, win) {
                return 1;
            }
        }
    }
    CallNextHookEx(null_mut(), code, message, data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_F4;

    #[test]
    fn matches_switch_chords_and_preserves_exit_shortcuts() {
        let down = true;
        assert!(is_switch_chord(u32::from(VK_TAB), LLKHF_ALTDOWN, down, false, false));
        assert!(!is_switch_chord(u32::from(VK_TAB), 0, down, false, false));
        assert!(!is_switch_chord(u32::from(VK_TAB), LLKHF_ALTDOWN, down, true, false));
        assert!(!is_switch_chord(u32::from(VK_TAB), LLKHF_ALTDOWN, !down, false, false));
        assert!(is_switch_chord(u32::from(VK_LWIN), 0, down, false, false));
        assert!(is_switch_chord(u32::from(VK_RWIN), 0, down, false, false));
        assert!(is_switch_chord(u32::from(VK_ESCAPE), 0, down, true, false));
        assert!(!is_switch_chord(u32::from(VK_ESCAPE), LLKHF_ALTDOWN, down, true, false));
        assert!(!is_switch_chord(u32::from(VK_ESCAPE), 0, !down, true, false));
        assert!(!is_switch_chord(u32::from(VK_F4), LLKHF_ALTDOWN, down, false, false));
        assert!(!is_switch_chord(u32::from(VK_DELETE), LLKHF_ALTDOWN, down, true, false));
    }
}
