// Hide the console window that would otherwise open alongside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    open_ed_web_lib::run()
}
