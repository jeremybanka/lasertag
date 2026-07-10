use std::collections::HashMap;

use zed::serde_json::Value;
use zed::settings::{CommandSettings, LspSettings};
use zed::{LanguageServerId, LanguageServerInstallationStatus, Result, Worktree};
use zed_extension_api as zed;

const LANGUAGE_SERVER_ID: &str = "lasertag";
const PACKAGE_NAME: &str = "lasertag";
const PACKAGE_VERSION: &str = "0.3.2";
const PATH_BINARY_NAME: &str = "lasertag-lsp";
const NPM_SERVER_MODULE: &str = "node_modules/lasertag/dist/lsp.mjs";
const LOG_LEVEL_ENV: &str = "LASERTAG_LSP_LOG_LEVEL";
const TYPESCRIPT_SDK_PATH_ENV: &str = "LASERTAG_TYPESCRIPT_SDK_PATH";

struct LasertagExtension;

#[derive(Clone, Debug, Eq, PartialEq)]
struct ServerConfiguration {
    log_level: Option<String>,
    typescript_sdk_path: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum ServerSource {
    ConfiguredBinary,
    PathBinary,
    NpmPackage,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ServerCommand {
    args: Vec<String>,
    command: String,
    env: Vec<(String, String)>,
    source: ServerSource,
}

impl zed::Extension for LasertagExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> Result<zed::Command> {
        let settings = LspSettings::for_worktree(LANGUAGE_SERVER_ID, worktree)?;
        let configuration = server_configuration(settings.settings.as_ref());
        let base_env = worktree.shell_env();

        if let Some(command) =
            configured_binary_command(settings.binary.as_ref(), base_env.clone(), &configuration)
        {
            return Ok(command.into());
        }

        if let Some(command_path) = worktree.which(PATH_BINARY_NAME) {
            let command = path_binary_command(command_path, base_env.clone(), &configuration);

            return Ok(command.into());
        }

        install_server_package(language_server_id)?;

        let command = npm_package_command(zed::node_binary_path()?, base_env, &configuration);

        Ok(command.into())
    }
}

zed::register_extension!(LasertagExtension);

impl From<ServerCommand> for zed::Command {
    fn from(command: ServerCommand) -> Self {
        Self {
            args: command.args,
            command: command.command,
            env: command.env,
        }
    }
}

fn install_server_package(language_server_id: &LanguageServerId) -> Result<()> {
    zed::set_language_server_installation_status(
        language_server_id,
        &LanguageServerInstallationStatus::CheckingForUpdate,
    );

    if zed::npm_package_installed_version(PACKAGE_NAME)?.as_deref() == Some(PACKAGE_VERSION) {
        zed::set_language_server_installation_status(
            language_server_id,
            &LanguageServerInstallationStatus::None,
        );
        return Ok(());
    }

    zed::set_language_server_installation_status(
        language_server_id,
        &LanguageServerInstallationStatus::Downloading,
    );

    match zed::npm_install_package(PACKAGE_NAME, PACKAGE_VERSION) {
        Ok(()) => {
            zed::set_language_server_installation_status(
                language_server_id,
                &LanguageServerInstallationStatus::None,
            );
            Ok(())
        }
        Err(error) => {
            zed::set_language_server_installation_status(
                language_server_id,
                &LanguageServerInstallationStatus::Failed(error.clone()),
            );
            Err(error)
        }
    }
}

fn configured_binary_command(
    settings: Option<&CommandSettings>,
    base_env: Vec<(String, String)>,
    configuration: &ServerConfiguration,
) -> Option<ServerCommand> {
    let settings = settings?;
    let command = trim_string(settings.path.as_deref())?;
    let args = settings.arguments.clone().unwrap_or_default();
    let env = merge_environment(
        base_env,
        settings.env.clone().unwrap_or_default(),
        configuration,
    );

    Some(ServerCommand {
        args,
        command,
        env,
        source: ServerSource::ConfiguredBinary,
    })
}

fn path_binary_command(
    command: String,
    base_env: Vec<(String, String)>,
    configuration: &ServerConfiguration,
) -> ServerCommand {
    ServerCommand {
        args: Vec::new(),
        command,
        env: merge_environment(base_env, HashMap::new(), configuration),
        source: ServerSource::PathBinary,
    }
}

fn npm_package_command(
    node_path: String,
    base_env: Vec<(String, String)>,
    configuration: &ServerConfiguration,
) -> ServerCommand {
    ServerCommand {
        args: vec![NPM_SERVER_MODULE.to_string()],
        command: node_path,
        env: merge_environment(base_env, HashMap::new(), configuration),
        source: ServerSource::NpmPackage,
    }
}

fn merge_environment(
    base_env: Vec<(String, String)>,
    overrides: HashMap<String, String>,
    configuration: &ServerConfiguration,
) -> Vec<(String, String)> {
    let mut merged: HashMap<String, String> = base_env.into_iter().collect();

    for (key, value) in overrides {
        merged.insert(key, value);
    }

    if let Some(log_level) = configuration.log_level.clone() {
        merged.insert(LOG_LEVEL_ENV.to_string(), log_level);
    }

    if let Some(typescript_sdk_path) = configuration.typescript_sdk_path.clone() {
        merged.insert(TYPESCRIPT_SDK_PATH_ENV.to_string(), typescript_sdk_path);
    }

    let mut env = merged.into_iter().collect::<Vec<_>>();
    env.sort_by(|left, right| left.0.cmp(&right.0));
    env
}

fn server_configuration(settings: Option<&Value>) -> ServerConfiguration {
    let lasertag = settings.and_then(|settings| settings.get("lasertag"));

    ServerConfiguration {
        log_level: nested_string(lasertag, &["log", "level"]),
        typescript_sdk_path: nested_string(lasertag, &["typescript", "sdk", "path"]),
    }
}

fn nested_string(value: Option<&Value>, path: &[&str]) -> Option<String> {
    let mut current = value?;

    for segment in path {
        current = current.get(segment)?;
    }

    trim_string(current.as_str())
}

fn trim_string(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();

    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zed::serde_json::json;

    fn configuration() -> ServerConfiguration {
        ServerConfiguration {
            log_level: Some("debug".to_string()),
            typescript_sdk_path: Some("/workspace/.bin/tsc".to_string()),
        }
    }

    #[test]
    fn parses_lasertag_settings() {
        let settings = json!({
            "lasertag": {
                "log": {
                    "level": "warn"
                },
                "typescript": {
                    "sdk": {
                        "path": " .bin/typescript/tsc "
                    }
                }
            }
        });

        assert_eq!(
            server_configuration(Some(&settings)),
            ServerConfiguration {
                log_level: Some("warn".to_string()),
                typescript_sdk_path: Some(".bin/typescript/tsc".to_string()),
            },
        );
    }

    #[test]
    fn ignores_blank_lasertag_settings() {
        let settings = json!({
            "lasertag": {
                "log": {
                    "level": " "
                },
                "typescript": {
                    "sdk": {
                        "path": ""
                    }
                }
            }
        });

        assert_eq!(
            server_configuration(Some(&settings)),
            ServerConfiguration {
                log_level: None,
                typescript_sdk_path: None,
            },
        );
    }

    #[test]
    fn merges_environment_with_configured_values_taking_precedence() {
        let env = merge_environment(
            vec![
                ("PATH".to_string(), "/usr/bin".to_string()),
                (LOG_LEVEL_ENV.to_string(), "info".to_string()),
            ],
            HashMap::from([
                ("EXTRA".to_string(), "1".to_string()),
                (LOG_LEVEL_ENV.to_string(), "error".to_string()),
            ]),
            &configuration(),
        );

        assert_eq!(
            env,
            vec![
                ("EXTRA".to_string(), "1".to_string()),
                (LOG_LEVEL_ENV.to_string(), "debug".to_string()),
                (
                    TYPESCRIPT_SDK_PATH_ENV.to_string(),
                    "/workspace/.bin/tsc".to_string()
                ),
                ("PATH".to_string(), "/usr/bin".to_string()),
            ],
        );
    }

    #[test]
    fn builds_path_binary_command() {
        let command = path_binary_command(
            "/usr/local/bin/lasertag-lsp".to_string(),
            vec![("PATH".to_string(), "/usr/bin".to_string())],
            &configuration(),
        );

        assert_eq!(command.source, ServerSource::PathBinary);
        assert_eq!(command.command, "/usr/local/bin/lasertag-lsp");
        assert!(command.args.is_empty());
        assert!(command
            .env
            .contains(&(LOG_LEVEL_ENV.to_string(), "debug".to_string())));
    }

    #[test]
    fn builds_npm_fallback_command() {
        let command = npm_package_command(
            "/zed/node".to_string(),
            Vec::new(),
            &ServerConfiguration {
                log_level: None,
                typescript_sdk_path: None,
            },
        );

        assert_eq!(
            command,
            ServerCommand {
                args: vec!["node_modules/lasertag/dist/lsp.mjs".to_string()],
                command: "/zed/node".to_string(),
                env: Vec::new(),
                source: ServerSource::NpmPackage,
            },
        );
    }
}
