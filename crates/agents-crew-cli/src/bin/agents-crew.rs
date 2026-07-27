#[tokio::main]
async fn main() {
    let exit_code = agents_crew_cli::run_cli().await;
    if exit_code != 0 {
        std::process::exit(exit_code);
    }
}
