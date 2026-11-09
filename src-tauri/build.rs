fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&[
        "pick_document",
        "read_document",
        "open_notification_settings",
        "set_study_fullscreen",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("failed to configure OpenStudy");
}
