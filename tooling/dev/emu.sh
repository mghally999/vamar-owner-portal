#!/usr/bin/env bash
# Small helpers for driving the Android emulator from scripts (used for app screenshots and
# rehearsals). Requires adb on PATH or ANDROID_HOME set.
#   emu.sh dump                 print visible texts with bounds
#   emu.sh wait "Sign in" 120   wait until a text is visible (presses Wait on ANR dialogs)
#   emu.sh tap "Send code"      tap the centre of the first element with that text
#   emu.sh type "500000001"     type into the focused field
#   emu.sh shot out.png         save a screenshot
#   emu.sh code +971500000001   latest Auth-emulator verification code for a phone number
export MSYS_NO_PATHCONV=1
ADB="${ADB:-${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}/platform-tools/adb}"
command -v "$ADB" >/dev/null 2>&1 || ADB="$ADB.exe"

dump() {
  "$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  "$ADB" shell cat /sdcard/ui.xml | tr '>' '\n' \
    | grep -oE '(text|content-desc)="[^"]+"[^>]*bounds="[^"]*"' \
    | sed -E 's/ (resource-id|checkable|checked|clickable|enabled|focusable|focused|scrollable|long-clickable|password|selected|visible-to-user|index|package|class)="[^"]*"//g'
}
center() { # $1 = bounds like [x1,y1][x2,y2]
  echo "$1" | sed -E 's/\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]/\1 \2 \3 \4/' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'
}
find_bounds() { # $1 = text; exact match first, then prefix match
  local d line
  d=$(dump)
  line=$(echo "$d" | grep -F "=\"$1\"" | head -1)
  [ -z "$line" ] && line=$(echo "$d" | grep -F "\"$1" | head -1)
  echo "$line" | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | tail -1
}
case "$1" in
  dump) dump ;;
  shot) "$ADB" exec-out screencap -p > "$2" && echo "saved $2" ;;
  tap)
    b=$(find_bounds "$2"); [ -z "$b" ] && { echo "not found: $2" >&2; exit 1; }
    read -r x y < <(center "$b"); "$ADB" shell input tap "$x" "$y" ;;
  tapxy) "$ADB" shell input tap "$2" "$3" ;;
  type) "$ADB" shell input text "$2" ;;
  key) "$ADB" shell input keyevent "$2" ;;
  wait)
    limit="${3:-120}"
    for ((i = 0; i < limit; i += 3)); do
      d=$(dump)
      if echo "$d" | grep -qF "\"$2"; then echo "visible: $2"; exit 0; fi
      if echo "$d" | grep -qE 'text="Wait"'; then
        b=$(echo "$d" | grep -E 'text="Wait"' | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | tail -1)
        read -r x y < <(center "$b"); "$ADB" shell input tap "$x" "$y"; echo "pressed Wait on ANR dialog"
      fi
      sleep 3
    done
    echo "timeout waiting for: $2" >&2; exit 1 ;;
  code)
    curl -s "http://127.0.0.1:9099/emulator/v1/projects/demo-vamar/verificationCodes"       | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const l=(JSON.parse(d).verificationCodes||[]).filter(v=>v.phoneNumber===process.argv[1]);console.log(l.length?l[l.length-1].code:"")})' "$2" ;;
  *) echo "usage: emu.sh dump|shot|tap|tapxy|type|key|wait|code" >&2; exit 2 ;;
esac
