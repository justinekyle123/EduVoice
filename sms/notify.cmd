@echo off
REM Scheduled-task wrapper for the task reminder cron.
REM
REM Task Scheduler runs this file (see sms/README.md, step 5) instead of calling
REM php.exe directly, so the scheduled command stays a single path with no nested
REM quoting, and so every run leaves a trace in sms/notify.log: a run with nothing
REM due writes nothing, a failure writes why.
REM
REM Change the path below if PHP lives somewhere else (this one is XAMPP's).

"C:\xampp\php\php.exe" "%~dp0notify.php" %* >> "%~dp0notify.log" 2>&1
