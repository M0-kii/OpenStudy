use std::{
    ffi::c_void,
    ptr::{null, null_mut},
    sync::atomic::{AtomicPtr, Ordering::Relaxed},
};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_RWIN, VK_TAB},
        WindowsAndMessaging::{
            CallNextHookEx, GetForegroundWindow, SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION,
            KBDLLHOOKSTRUCT, LLKHF_ALTDOWN, WH_KEYBOARD_LL,
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

fn is_switch_chord(vk_code: u32, flags: u32) -> bool {
    vk_code == u32::from(VK_TAB) && flags & LLKHF_ALTDOWN != 0
}

unsafe extern "system" fn filter(code: i32, message: WPARAM, data: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let reader = READER.load(Relaxed);
        if !reader.is_null() && GetForegroundWindow() == reader {
            // Win32 supplies a KBDLLHOOKSTRUCT for the duration of an HC_ACTION callback.
            let event = &*(data as *const KBDLLHOOKSTRUCT);
            // The modifiers were pressed before Tab and their async state is already available.
            if is_switch_chord(event.vkCode, event.flags)
                && [VK_CONTROL, VK_LWIN, VK_RWIN]
                    .into_iter()
                    .all(|key| GetAsyncKeyState(i32::from(key)) >= 0)
            {
                return 1;
            }
        }
    }
    CallNextHookEx(null_mut(), code, message, data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{VK_ESCAPE, VK_F4};

    #[test]
    fn matches_alt_tab_and_preserves_exit_shortcuts() {
        assert!(is_switch_chord(u32::from(VK_TAB), LLKHF_ALTDOWN));
        assert!(!is_switch_chord(u32::from(VK_TAB), 0));
        assert!(!is_switch_chord(u32::from(VK_ESCAPE), LLKHF_ALTDOWN));
        assert!(!is_switch_chord(u32::from(VK_F4), LLKHF_ALTDOWN));
    }
}
