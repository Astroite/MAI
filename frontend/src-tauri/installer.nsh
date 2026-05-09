; NSIS hooks for MAI installer / uninstaller.
;
; Problem: on Windows the backend sidecar (mai-backend.exe) holds an exclusive
; file lock while running. If the user reinstalls or upgrades while MAI is
; still open — or while an orphan sidecar is alive after a previous crash —
; the installer cannot overwrite the .exe and aborts with "file in use".
;
; Solution: kill MAI.exe and mai-backend.exe before extracting files, both on
; install and uninstall. Errors (e.g. process not found) are ignored.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping any running MAI instance..."
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM MAI.exe'
  Pop $0
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM mai-backend.exe'
  Pop $0
  ; Give Windows a moment to release the file handles before NSIS tries to
  ; overwrite the executables. Without this the very first install attempt
  ; right after a kill can still hit a transient lock.
  Sleep 800
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping MAI before uninstall..."
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM MAI.exe'
  Pop $0
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM mai-backend.exe'
  Pop $0
  Sleep 800
!macroend
