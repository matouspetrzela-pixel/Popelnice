Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd /d ""c:\Development\projekty\Popelnice\backend"" && node dist\index.js >> ""c:\Development\projekty\Popelnice\popelnice.log"" 2>&1", 0, False
