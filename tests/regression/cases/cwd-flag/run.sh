# cwd-flag: rosie --cwd <path> install ... must operate in <path> regardless
# of the shell's actual working directory. We invoke from /tmp but target
# the staged subdirectory.

mkdir -p "$HOME/.claude"
mkdir -p sub/project

cd /tmp  # force cwd far from PROJECT_DIR
"$ROSIE" --cwd "$PROJECT_DIR/sub/project" install -y fake-org/skills > "$PROJECT_DIR/stdout" 2> "$PROJECT_DIR/stderr"
echo $? > "$PROJECT_DIR/exit_code"
cd "$PROJECT_DIR"
