fn main() {
    #[cfg(target_os = "macos")]
    {
        use std::fs;
        use std::path::PathBuf;
        use std::process::Command;

        println!("cargo:rerun-if-changed=src/mac_notification.m");
        println!("cargo:rerun-if-changed=src/mac_notification.h");
        println!("cargo:rerun-if-changed=icons/icon.icns");

        let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR not set"));
        let app_dir = out_dir.join("Waterball.app");
        let contents_dir = app_dir.join("Contents");
        let macos_dir = contents_dir.join("MacOS");
        let resources_dir = contents_dir.join("Resources");

        fs::create_dir_all(&macos_dir).expect("Failed to create helper MacOS dir");
        fs::create_dir_all(&resources_dir).expect("Failed to create helper Resources dir");

        let _ = fs::copy("icons/icon.icns", resources_dir.join("icon.icns"));

        let info_plist = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>English</string>
	<key>CFBundleDisplayName</key>
	<string>Waterball</string>
	<key>CFBundleExecutable</key>
	<string>bbsterm</string>
	<key>CFBundleIdentifier</key>
	<string>com.waterball.bbs</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>Waterball</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>0.1.9</string>
	<key>CFBundleVersion</key>
	<string>0.1.9</string>
	<key>CFBundleIconFile</key>
	<string>icon.icns</string>
	<key>LSMultipleInstancesProhibited</key>
	<true/>
</dict>
</plist>
"#;
        fs::write(contents_dir.join("Info.plist"), info_plist)
            .expect("Failed to write helper Info.plist");

        let helper_exec = macos_dir.join("bbsterm");
        let clang_status = Command::new("clang")
            .args([
                "-fobjc-arc",
                "-fobjc-exceptions",
                "-DWATERBALL_HELPER_MAIN=1",
                "-framework",
                "Foundation",
                "-framework",
                "UserNotifications",
                "-framework",
                "AppKit",
                "src/mac_notification.m",
                "-o",
            ])
            .arg(&helper_exec)
            .status()
            .expect("Failed to invoke clang for macOS notification helper");
        assert!(clang_status.success(), "Failed to compile macOS notification helper");

        let codesign_status = Command::new("codesign")
            .args(["--force", "--deep", "--sign", "-"])
            .arg(&app_dir)
            .status()
            .expect("Failed to invoke codesign for macOS notification helper");
        assert!(codesign_status.success(), "Failed to sign macOS notification helper");

        let escaped_helper_path = helper_exec
            .to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        let define_val = format!("\"{}\"", escaped_helper_path);

        cc::Build::new()
            .file("src/mac_notification.m")
            .flag("-fobjc-arc")
            .flag("-fobjc-exceptions")
            .define("WATERBALL_DEV_HELPER_PATH", define_val.as_str())
            .compile("mac_notification");

        println!("cargo:rustc-link-lib=framework=UserNotifications");
        println!("cargo:rustc-link-lib=framework=AppKit");
    }

    tauri_build::build()
}
