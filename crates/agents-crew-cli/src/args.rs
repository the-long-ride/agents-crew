use clap::{Args, Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(
    name = "crew",
    version,
    about = "Rust-enforced multi-agent crew orchestration"
)]
pub struct Cli {
    #[arg(long, global = true, default_value = ".")]
    pub workspace: PathBuf,
    #[arg(long, global = true)]
    pub json: bool,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    Init(InitArgs),
    Ui(UiArgs),
    Start(StartArgs),
    Run(GoalArgs),
    Plan(GoalArgs),
    Status(RunSelector),
    Resume(RunSelector),
    Pause(RunSelector),
    Approve(ApprovalArgs),
    Reject(ApprovalArgs),
    Cancel(RunSelector),
    Doctor,
    Template {
        #[command(subcommand)]
        command: TemplateCommand,
    },
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    Plugin {
        #[command(subcommand)]
        command: PluginCommand,
    },
    Worker {
        #[command(subcommand)]
        command: WorkerCommand,
    },
    Manager {
        #[command(subcommand)]
        command: ManagerCommand,
    },
}

#[derive(Debug, Args)]
pub struct InitArgs {
    #[arg(long)]
    pub non_interactive: bool,
    #[arg(long)]
    pub force: bool,
}

#[derive(Debug, Args)]
pub struct UiArgs {
    #[arg(long, default_value_t = 0)]
    pub port: u16,
    #[arg(long)]
    pub no_open: bool,
}

#[derive(Debug, Args)]
pub struct StartArgs {
    pub template_id: String,
    #[arg(long, required = true)]
    pub goal: String,
    #[arg(long = "expectation")]
    pub expectations: Vec<String>,
    #[arg(long = "acceptance")]
    pub acceptance_criteria: Vec<String>,
    #[arg(long = "constraint")]
    pub constraints: Vec<String>,
}

#[derive(Debug, Args)]
pub struct GoalArgs {
    #[arg(required = true, num_args = 1..)]
    pub goal: Vec<String>,
}

#[derive(Debug, Args, Default)]
pub struct RunSelector {
    pub id: Option<String>,
    #[arg(long, conflicts_with = "id")]
    pub run: Option<String>,
}

impl RunSelector {
    #[must_use]
    pub fn selected(&self) -> Option<&str> {
        self.id.as_deref().or(self.run.as_deref())
    }
}

#[derive(Debug, Args)]
pub struct ApprovalArgs {
    pub approval_id: String,
    #[arg(long)]
    pub run: Option<String>,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum TemplateScopeArg {
    Global,
    Workspace,
}

#[derive(Debug, Subcommand)]
pub enum TemplateCommand {
    List,
    Show { id: String },
    Validate { id: String },
    Delete {
        id: String,
        #[arg(long, value_enum)]
        scope: TemplateScopeArg,
    },
}

#[derive(Debug, Subcommand)]
pub enum ConfigCommand {
    Validate,
    Show,
}

#[derive(Debug, Subcommand)]
pub enum PluginCommand {
    List,
    Install {
        host: String,
        #[arg(long)]
        force: bool,
    },
    Doctor {
        host: String,
    },
    Uninstall {
        host: String,
    },
}

#[derive(Debug, Subcommand)]
pub enum WorkerCommand {
    Probe,
    Run { worker: String, task: PathBuf },
}

#[derive(Debug, Subcommand)]
pub enum ManagerCommand {
    Start {
        #[arg(long, required = true)]
        goal: String,
        #[arg(long, required = true)]
        host: String,
    },
    Step {
        #[arg(long)]
        run: String,
    },
    Submit {
        #[arg(long)]
        run: String,
        #[arg(long)]
        action: String,
        #[arg(long)]
        result: PathBuf,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn parses_template_start_with_durable_prompt_fields() {
        let cli = Cli::try_parse_from([
            "agents-crew",
            "start",
            "fullstack-review",
            "--goal",
            "ship feature",
            "--expectation",
            "keep compatibility",
            "--acceptance",
            "tests pass",
        ])
        .unwrap();
        let Command::Start(args) = cli.command else {
            panic!("expected start command");
        };
        assert_eq!(args.template_id, "fullstack-review");
        assert_eq!(args.expectations, ["keep compatibility"]);
        assert_eq!(args.acceptance_criteria, ["tests pass"]);
    }

    #[test]
    fn resume_accepts_positional_run_id() {
        let cli = Cli::try_parse_from(["agents-crew", "resume", "run-123"]).unwrap();
        let Command::Resume(selector) = cli.command else {
            panic!("expected resume command");
        };
        assert_eq!(selector.selected(), Some("run-123"));
    }

    #[test]
    fn parses_loopback_ui_options() {
        let cli = Cli::try_parse_from(["agents-crew", "ui", "--port", "4815", "--no-open"])
            .unwrap();
        let Command::Ui(args) = cli.command else {
            panic!("expected ui command");
        };
        assert_eq!(args.port, 4815);
        assert!(args.no_open);
    }
}
