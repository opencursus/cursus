// Windows taskbar unread-count badge via ITaskbarList3::SetOverlayIcon.
// On non-Windows this module is a no-op; macOS NSDockTile wiring can be
// added in a separate cfg branch if needed.

use crate::error::{Error, Result};

#[cfg(windows)]
use crate::badge_data::BADGES;

#[cfg(windows)]
pub fn set_unread(hwnd_raw: isize, count: u32) -> Result<()> {
    use windows::core::{w, Interface, GUID};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::ITaskbarList3;
    use windows::Win32::UI::WindowsAndMessaging::{CreateIconFromResourceEx, HICON};

    // CLSID_TaskbarList = {56FDF344-FD6D-11d0-958A-006097C9A090}
    const CLSID_TASKBAR_LIST: GUID = GUID::from_u128(0x56FDF344_FD6D_11d0_958A_006097C9A090);

    let hwnd = HWND(hwnd_raw as *mut _);

    unsafe {
        // COINIT_APARTMENTTHREADED is the safest choice here; calling
        // CoInitializeEx again on an already-initialised apartment returns
        // S_FALSE, which we ignore by not checking the HRESULT.
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let taskbar: ITaskbarList3 =
            CoCreateInstance(&CLSID_TASKBAR_LIST, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| Error::Config(format!("taskbar CoCreateInstance: {e}")))?;

        if count == 0 {
            taskbar
                .SetOverlayIcon(hwnd, HICON::default(), w!(""))
                .map_err(|e| Error::Config(format!("clear overlay: {e}")))?;
            return Ok(());
        }

        // Index 0..=98 corresponds to counts 1..=99. Anything >= 100 uses
        // the trailing "99+" badge at index 99.
        let idx: usize = if count >= 100 { 99 } else { (count - 1) as usize };
        let ico_bytes = BADGES[idx];

        // dwVer must be 0x00030000 for modern icons per MS docs.
        let hicon: HICON =
            CreateIconFromResourceEx(ico_bytes, true, 0x00030000, 32, 32, Default::default())
                .map_err(|e| Error::Config(format!("CreateIconFromResourceEx: {e}")))?;

        // Best-effort: don't abort the command if SetOverlayIcon happens
        // to fail at a given moment — just surface the error.
        taskbar
            .SetOverlayIcon(hwnd, hicon, w!("Unread"))
            .map_err(|e| Error::Config(format!("SetOverlayIcon: {e}")))?;
        let _ = taskbar.vtable();
        let _ = hicon;
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn set_unread(_hwnd_raw: isize, _count: u32) -> Result<()> {
    Ok(())
}
