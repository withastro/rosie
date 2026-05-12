# version-flag: rosie --version prints the version on stdout and exits 0.

"$ROSIE" --version > stdout 2> stderr
echo $? > exit_code
