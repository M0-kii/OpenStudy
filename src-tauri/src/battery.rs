#[derive(Debug, PartialEq, Eq, serde::Serialize)]
pub(crate) struct BatteryStatus {
    percent: u8,
    charging: bool,
}

#[tauri::command]
pub(crate) async fn get_battery_status(
    window: tauri::WebviewWindow,
) -> Result<Option<BatteryStatus>, String> {
    if window.label() != "main" {
        return Err("Battery status is available only from the main window.".into());
    }
    tauri::async_runtime::spawn_blocking(read_status)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
fn read_status() -> Option<BatteryStatus> {
    use windows_sys::Win32::System::Power::{
        GetPwrCapabilities, GetSystemPowerStatus, SYSTEM_POWER_CAPABILITIES, SYSTEM_POWER_STATUS,
    };

    let mut status = SYSTEM_POWER_STATUS::default();
    // Win32 fills the caller-owned struct on success.
    if unsafe { GetSystemPowerStatus(&mut status) } == 0 {
        return None;
    }
    let battery = windows_status(
        status.ACLineStatus,
        status.BatteryFlag,
        status.BatteryLifePercent,
    )?;

    let mut capabilities = SYSTEM_POWER_CAPABILITIES::default();
    // Win32 can otherwise report a desktop UPS as a system battery.
    if unsafe { GetPwrCapabilities(&mut capabilities) } && capabilities.BatteriesAreShortTerm {
        return None;
    }
    Some(battery)
}

#[cfg(any(windows, test))]
fn windows_status(ac_line: u8, flags: u8, percent: u8) -> Option<BatteryStatus> {
    const UNKNOWN: u8 = 255;
    const NO_BATTERY: u8 = 128;
    const CHARGING: u8 = 8;

    if percent > 100 || (flags != UNKNOWN && flags & NO_BATTERY != 0) {
        return None;
    }
    let charging = match (ac_line, flags != UNKNOWN && flags & CHARGING != 0) {
        (1, _) | (_, true) => true,
        (0, false) => false,
        _ => return None,
    };
    Some(BatteryStatus { percent, charging })
}

#[cfg(target_os = "macos")]
fn read_status() -> Option<BatteryStatus> {
    let output = std::process::Command::new("/usr/bin/pmset")
        .args(["-g", "batt"])
        .env("LC_ALL", "C")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    macos_status(std::str::from_utf8(&output.stdout).ok()?)
}

#[cfg(any(target_os = "macos", test))]
fn macos_status(output: &str) -> Option<BatteryStatus> {
    let mut lines = output.lines();
    let charging = match lines.next()?.trim() {
        "Now drawing from 'AC Power'" => true,
        "Now drawing from 'Battery Power'" => false,
        _ => return None,
    };
    let battery = lines.find(|line| {
        line.trim_start().starts_with("-InternalBattery-") && !line.contains("present: false")
    })?;
    let percent: u8 = battery
        .split_once('%')?
        .0
        .split_whitespace()
        .last()?
        .parse()
        .ok()?;
    (percent <= 100).then_some(BatteryStatus { percent, charging })
}

#[cfg(target_os = "linux")]
fn read_status() -> Option<BatteryStatus> {
    linux_status(std::path::Path::new("/sys/class/power_supply"))
}

#[cfg(any(target_os = "linux", test))]
fn linux_status(root: &std::path::Path) -> Option<BatteryStatus> {
    use std::fs;

    let mut batteries = 0_u64;
    let mut percent_sum = 0_u64;
    let mut weighted_batteries = 0_u64;
    let mut total_energy = 0_u128;
    let mut weighted_percent = 0_u128;
    let mut plugged = false;
    let mut discharging = false;
    let mut idle = false;

    for entry in fs::read_dir(root).ok()?.flatten() {
        let path = entry.path();
        let attribute = |name: &str| fs::read_to_string(path.join(name)).unwrap_or_default();
        let scope = attribute("scope");
        if scope.trim() == "Device" {
            continue;
        }
        let kind = attribute("type");
        if kind.trim() != "Battery" {
            if (kind.trim() == "Mains" || scope.trim() == "System")
                && matches!(attribute("online").trim(), "1" | "2")
            {
                plugged = true;
            }
            continue;
        }
        if attribute("present").trim() == "0" {
            continue;
        }

        let percent = attribute("capacity")
            .trim()
            .parse::<u8>()
            .ok()
            .filter(|p| *p <= 100)?;
        batteries += 1;
        percent_sum += u64::from(percent);
        if let Some(energy) = attribute("energy_full")
            .trim()
            .parse::<u64>()
            .ok()
            .filter(|n| *n > 0)
        {
            weighted_batteries += 1;
            total_energy += u128::from(energy);
            weighted_percent += u128::from(energy) * u128::from(percent);
        }
        match attribute("status").trim() {
            "Charging" => plugged = true,
            "Discharging" => discharging = true,
            "Full" | "Not charging" => idle = true,
            _ => {}
        }
    }

    if batteries == 0 || !(plugged || discharging || idle) {
        return None;
    }
    let percent = if weighted_batteries == batteries {
        (weighted_percent / total_energy) as u8
    } else {
        // shortcut: average pack percentages when a driver omits energy_full, use energy weighting when all packs report it.
        (percent_sum / batteries) as u8
    };
    Some(BatteryStatus {
        percent,
        charging: plugged || !discharging,
    })
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn read_status() -> Option<BatteryStatus> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::Path};

    #[test]
    fn windows_distinguishes_external_power_from_unknown_status() {
        assert_eq!(
            windows_status(0, 2, 16),
            Some(BatteryStatus {
                percent: 16,
                charging: false
            })
        );
        assert_eq!(
            windows_status(1, 2, 16),
            Some(BatteryStatus {
                percent: 16,
                charging: true
            })
        );
        assert_eq!(
            windows_status(255, 8, 16),
            Some(BatteryStatus {
                percent: 16,
                charging: true
            })
        );
        assert_eq!(windows_status(255, 255, 16), None);
        assert_eq!(windows_status(1, 128, 0), None);
        assert_eq!(windows_status(1, 0, 255), None);
    }

    #[test]
    fn macos_requires_an_internal_battery_and_known_power_source() {
        let battery =
            " -InternalBattery-0 (id=123456)\t18%; discharging; 0:40 remaining present: true\n";
        assert_eq!(
            macos_status(&format!("Now drawing from 'Battery Power'\n{battery}")),
            Some(BatteryStatus {
                percent: 18,
                charging: false
            })
        );
        assert_eq!(
            macos_status(&format!("Now drawing from 'AC Power'\n{battery}")),
            Some(BatteryStatus {
                percent: 18,
                charging: true
            })
        );
        assert_eq!(
            macos_status("Now drawing from 'AC Power'\n -UPS-0\t5%; discharging\n"),
            None
        );
        assert_eq!(
            macos_status(
                "Now drawing from 'Battery Power'\n -InternalBattery-0\t1%; present: false\n"
            ),
            None
        );
    }

    fn supply(root: &Path, name: &str, fields: &[(&str, &str)]) {
        let path = root.join(name);
        fs::create_dir(&path).unwrap();
        for (field, value) in fields {
            fs::write(path.join(field), value).unwrap();
        }
    }

    #[test]
    fn linux_ignores_peripheral_batteries_and_accounts_for_mains() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        supply(
            root,
            "mouse",
            &[
                ("type", "Battery"),
                ("scope", "Device"),
                ("capacity", "2"),
                ("status", "Discharging"),
            ],
        );
        assert_eq!(linux_status(root), None);
        supply(
            root,
            "BAT0",
            &[
                ("type", "Battery\n"),
                ("capacity", "10\n"),
                ("status", "Discharging"),
                ("energy_full", "30"),
            ],
        );
        supply(
            root,
            "BAT1",
            &[
                ("type", "Battery"),
                ("capacity", "50"),
                ("status", "Not charging"),
                ("energy_full", "10"),
            ],
        );
        assert_eq!(
            linux_status(root),
            Some(BatteryStatus {
                percent: 20,
                charging: false
            })
        );
        supply(root, "AC", &[("type", "Mains"), ("online", "1\n")]);
        assert_eq!(
            linux_status(root),
            Some(BatteryStatus {
                percent: 20,
                charging: true
            })
        );
        fs::write(root.join("AC/online"), "0").unwrap();
        supply(
            root,
            "USB_PD",
            &[("type", "USB"), ("scope", "System"), ("online", "2")],
        );
        assert!(linux_status(root).unwrap().charging);
    }
}
