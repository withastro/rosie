# help-flag: rosie help prints the usage banner and exits 0.

"$ROSIE" help > stdout 2> stderr
echo $? > exit_code
