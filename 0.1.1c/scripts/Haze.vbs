' Запускает Haze из исходников (двойной клик или ярлык). Консоли не будет: electron.exe — оконное приложение.
' Стиль окна 1, а не 0: со стилем 0 Windows прячет первое показанное окно (настройки открывались серыми).
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)) & "\app"
exe = dir & "\node_modules\electron\dist\electron.exe"
CreateObject("WScript.Shell").Run """" & exe & """ """ & dir & """", 1, False
