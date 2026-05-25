# list-global-empty: `rosie list -g` with no global lockfile should print
# the empty-state hint, not the project-scoped wording.

"$ROSIE" list -g > stdout 2> stderr
echo $? > exit_code
