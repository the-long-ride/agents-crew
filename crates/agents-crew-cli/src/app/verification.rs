use super::*;

pub(super) async fn run_verification(
    workspace: &Path,
    commands: &[Vec<String>],
) -> Vec<TestResult> {
    let mut results = Vec::new();
    for parts in commands {
        if parts.is_empty() {
            continue;
        }
        let output = TokioCommand::new(&parts[0])
            .args(&parts[1..])
            .current_dir(workspace)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await;
        match output {
            Ok(output) => results.push(TestResult {
                command: parts.clone(),
                status: if output.status.success() {
                    TestStatus::Passed
                } else {
                    TestStatus::Failed
                },
                summary: format!(
                    "stdout: {}\nstderr: {}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                ),
                exit_code: output.status.code(),
            }),
            Err(error) => results.push(TestResult {
                command: parts.clone(),
                status: TestStatus::Blocked,
                summary: error.to_string(),
                exit_code: None,
            }),
        }
    }
    results
}
