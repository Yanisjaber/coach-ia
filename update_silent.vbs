' update_silent.vbs
' Lance update_data.bat de façon totalement silencieuse (aucune fenêtre).
' À utiliser dans Task Scheduler pour ne pas voir de CMD popup toutes les 15 min.

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Se positionner dans le dossier du script
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = """" & scriptDir & "\update_data.bat" & """"

' Run en mode caché (0 = hidden, False = ne pas attendre la fin)
WshShell.Run "cmd /c " & batPath, 0, False
