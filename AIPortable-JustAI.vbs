' AIPortable-JustAI.vbs - double-click launcher for Windows.
'
' Resolves its own folder (not a hardcoded path), so this works identically
' whether it's run from E:\AIPortable-JustAI, a USB drive, or that same drive
' plugged into a different machine under a different letter. Runs without
' popping up a console window.
'
' Prefers a packaged build (dist\win-unpacked\AIPortable-JustAI.exe) if one
' exists. Otherwise runs from source using Electron's own executable from
' node_modules directly - so Node.js itself is NOT needed at launch time,
' only during setup.

Dim oShell, oFso, sDir
Set oShell = CreateObject("WScript.Shell")
Set oFso = CreateObject("Scripting.FileSystemObject")
sDir = oFso.GetParentFolderName(WScript.ScriptFullName)
oShell.CurrentDirectory = sDir

Dim sPackaged, sElectron
sPackaged = sDir & "\dist\win-unpacked\AIPortable-JustAI.exe"
sElectron = sDir & "\node_modules\electron\dist\electron.exe"

If oFso.FileExists(sPackaged) Then
  oShell.Run """" & sPackaged & """", 1, False
ElseIf oFso.FileExists(sElectron) Then
  oShell.Run """" & sElectron & """ """ & sDir & """", 1, False
Else
  MsgBox "Setup isn't finished yet." & vbCrLf & vbCrLf & _
    "Double-click Setup-Windows.bat in this folder first." & vbCrLf & _
    "It needs an internet connection once. After it finishes, double-click " & _
    "this file again.", vbExclamation, "AIPortable-JustAI"
End If
