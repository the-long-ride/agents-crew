use super::*;

pub(super) async fn ui_command(workspace: &Path, args: UiArgs) -> Result<Value> {
    agents_crew_ui::serve(
        workspace.to_path_buf(),
        agents_crew_ui::UiOptions {
            port: args.port,
            open_browser: !args.no_open,
        },
    )
    .await?;
    Ok(json!({ "stopped": true }))
}
