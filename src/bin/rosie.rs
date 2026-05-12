fn main() -> std::process::ExitCode {
    std::process::ExitCode::from(rosie::cli::main() as u8)
}
