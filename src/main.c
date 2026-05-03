#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <getopt.h>
#include "install.h"
#include "download.h"
#include "agent.h"
#include "util.h"

#define ROSIE_VERSION "0.3.1"

static void print_usage(const char *prog) {
    printf("rosie - A robot helper for agent skills v%s\n\n", ROSIE_VERSION);
    printf("Usage: %s <command> [options] [arguments]\n\n", prog);
    printf("Commands:\n");
    printf("  install [<owner/repo>|<./path>] [skill]\n");
    printf("                                Install skills from a GitHub repository, or symlink a\n");
    printf("                                local directory (./path, /path, ~/path) into .agents/skills/.\n");
    printf("                                With no args, reinstalls from .agents/rosie.lock\n");
    printf("  update [skill-name]           Re-resolve lockfile entries; reinstall those that changed\n");
    printf("  remove <skill-name>           Remove an installed skill\n");
    printf("  list [owner/repo]             List skills in a repo (or installed skills if no arg)\n");
    printf("  agents                  List detected agents\n");
    printf("  help                    Show this help message\n");
    printf("\nOptions:\n");
    printf("  -a, --agent <name>      Target specific agent (can be repeated)\n");
    printf("  -g, --global            Install to home directory (~/.agent/skills/)\n");
    printf("  -l, --local             Install to current directory (default, uses symlinks)\n");
    printf("  -y, --yes               Skip confirmation prompt\n");
    printf("  -v, --verbose           Enable verbose output\n");
    printf("  -h, --help              Show this help message\n");
    printf("  -V, --version           Print version and exit\n");
    printf("\nExamples:\n");
    printf("  %s install vercel-labs/agent-skills\n", prog);
    printf("  %s install anthropics/skills pdf\n", prog);
    printf("  %s install owner/repo -a claude -a cursor\n", prog);
    printf("  %s install owner/repo@v1.0.0\n", prog);
    printf("  %s install ./skills/my-custom-skill   # symlink a local skill\n", prog);
    printf("  %s install                    # reinstall from .agents/rosie.lock\n", prog);
    printf("  %s update                     # update all lockfile entries\n", prog);
    printf("  %s update slack-gif-creator   # update one skill\n", prog);
    printf("  %s list                       # show installed skills\n", prog);
    printf("  %s list vercel-labs/agent-skills\n", prog);
    printf("  %s remove vercel-react-best-practices\n", prog);
    printf("  %s agents\n", prog);
}

static void print_agents(void) {
    printf("Detected agents:\n");
    AgentList *agents = detect_agents(true);  // Show global paths

    if (agents->count == 0) {
        printf("  (no agents detected)\n");
    } else {
        for (int i = 0; i < agents->count; i++) {
            printf("  %s (%s)\n",
                   agents->agents[i].def->display,
                   agents->agents[i].install_path);
        }
    }

    printf("\nSupported agents:\n");
    const AgentDef *defs = get_agent_definitions();
    for (int i = 0; defs[i].name != NULL; i++) {
        printf("  %-12s %s\n", defs[i].name, defs[i].display);
    }

    agent_list_free(agents);
}

static int cmd_install(int argc, char **argv, bool list_only) {
    static struct option long_options[] = {
        {"agent",   required_argument, 0, 'a'},
        {"global",  no_argument,       0, 'g'},
        {"local",   no_argument,       0, 'l'},
        {"yes",     no_argument,       0, 'y'},
        {"verbose", no_argument,       0, 'v'},
        {"help",    no_argument,       0, 'h'},
        {0, 0, 0, 0}
    };

    InstallOptions opts = {0};
    opts.global = false;  // Default to local install (like npm)
    opts.list_only = list_only;

    // Collect agent names
    const char *agent_names[32];
    int agent_count = 0;

    int opt;
    optind = 1;  // Reset getopt

    while ((opt = getopt_long(argc, argv, "a:glycvh", long_options, NULL)) != -1) {
        switch (opt) {
            case 'a':
                if (agent_count < 32) {
                    agent_names[agent_count++] = optarg;
                }
                break;
            case 'g':
                opts.global = true;
                break;
            case 'l':
                opts.global = false;
                break;
            case 'y':
                opts.yes = true;
                break;
            case 'v':
                g_verbose = true;
                break;
            case 'h':
                print_usage(argv[0]);
                return 0;
            default:
                return 1;
        }
    }

    if (optind >= argc) {
        // Zero-arg list: show what's recorded in the project's lockfile.
        if (list_only) {
            return list_installed_skills();
        }
        // Zero-arg install: reinstall everything in .agents/rosie.lock.
        opts.agent_names = agent_count > 0 ? agent_names : NULL;
        opts.agent_count = agent_count;
        if (download_init() != 0) return 1;
        int result = install_from_lockfile(&opts);
        download_cleanup();
        return result;
    }

    opts.spec = argv[optind];
    opts.skill_name = (optind + 1 < argc) ? argv[optind + 1] : NULL;
    opts.agent_names = agent_count > 0 ? agent_names : NULL;
    opts.agent_count = agent_count;

    // Initialize curl
    if (download_init() != 0) {
        return 1;
    }

    int result = install_package(&opts);

    download_cleanup();
    return result;
}

static int cmd_update(int argc, char **argv) {
    static struct option long_options[] = {
        {"agent",   required_argument, 0, 'a'},
        {"yes",     no_argument,       0, 'y'},
        {"verbose", no_argument,       0, 'v'},
        {"help",    no_argument,       0, 'h'},
        {0, 0, 0, 0}
    };

    InstallOptions opts = {0};
    const char *agent_names[32];
    int agent_count = 0;

    int opt;
    optind = 1;
    while ((opt = getopt_long(argc, argv, "a:yvh", long_options, NULL)) != -1) {
        switch (opt) {
            case 'a':
                if (agent_count < 32) agent_names[agent_count++] = optarg;
                break;
            case 'y': opts.yes = true; break;
            case 'v': g_verbose = true; break;
            case 'h':
                printf("Usage: rosie update [skill-name]\n");
                printf("  Re-resolve and reinstall lockfile entries that have changed upstream.\n");
                return 0;
            default: return 1;
        }
    }

    const char *only_skill = (optind < argc) ? argv[optind] : NULL;
    opts.agent_names = agent_count > 0 ? agent_names : NULL;
    opts.agent_count = agent_count;

    if (download_init() != 0) return 1;
    int result = update_skills(&opts, only_skill);
    download_cleanup();
    return result;
}

static int cmd_remove(int argc, char **argv) {
    static struct option long_options[] = {
        {"agent",   required_argument, 0, 'a'},
        {"global",  no_argument,       0, 'g'},
        {"local",   no_argument,       0, 'l'},
        {"yes",     no_argument,       0, 'y'},
        {"verbose", no_argument,       0, 'v'},
        {"help",    no_argument,       0, 'h'},
        {0, 0, 0, 0}
    };

    RemoveOptions opts = {0};
    opts.global = false;  // Default to local (like npm)

    const char *agent_names[32];
    int agent_count = 0;

    int opt;
    optind = 1;

    while ((opt = getopt_long(argc, argv, "a:glyvh", long_options, NULL)) != -1) {
        switch (opt) {
            case 'a':
                if (agent_count < 32) {
                    agent_names[agent_count++] = optarg;
                }
                break;
            case 'g':
                opts.global = true;
                break;
            case 'l':
                opts.global = false;
                break;
            case 'y':
                opts.yes = true;
                break;
            case 'v':
                g_verbose = true;
                break;
            case 'h':
                print_usage(argv[0]);
                return 0;
            default:
                return 1;
        }
    }

    if (optind >= argc) {
        log_error("Missing skill name");
        printf("Usage: rosie remove <skill-name>\n");
        return 1;
    }

    opts.skill_name = argv[optind];
    opts.agent_names = agent_count > 0 ? agent_names : NULL;
    opts.agent_count = agent_count;

    return remove_skill(&opts);
}

int main(int argc, char **argv) {
    if (argc < 2) {
        print_usage(argv[0]);
        return 1;
    }

    const char *command = argv[1];

    // Shift arguments for subcommand
    argc--;
    argv++;

    if (strcmp(command, "install") == 0) {
        return cmd_install(argc, argv, false);
    } else if (strcmp(command, "update") == 0) {
        return cmd_update(argc, argv);
    } else if (strcmp(command, "remove") == 0) {
        return cmd_remove(argc, argv);
    } else if (strcmp(command, "list") == 0) {
        return cmd_install(argc, argv, true);
    } else if (strcmp(command, "agents") == 0) {
        print_agents();
        return 0;
    } else if (strcmp(command, "help") == 0 || strcmp(command, "--help") == 0 || strcmp(command, "-h") == 0) {
        print_usage("rosie");
        return 0;
    } else if (strcmp(command, "--version") == 0 || strcmp(command, "-V") == 0) {
        printf("%s\n", ROSIE_VERSION);
        return 0;
    } else {
        log_error("Unknown command: %s", command);
        printf("Run 'rosie help' for usage.\n");
        return 1;
    }
}
