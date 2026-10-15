# Android permissions

| Permission | Mode | Why | When asked | If refused |
| --- | --- | --- | --- | --- |
| `READ_PHONE_STATE` | both | detect ringing / in call / idle | first launch (ops) or onboarding (guard) | no call events |
| `READ_CALL_LOG` | both | caller number (Android 9+) and the authoritative outcome and duration after the call | same | calls detected as "unknown number", durations guessed from call state |
| `PROCESS_OUTGOING_CALLS` (≤ Android 9) | both | dialled number on old Android | install-time | outgoing number from the call log instead |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | guard | one GPS fix per check during shifts | onboarding card 1 | no monitoring; `LOCATION_UNAVAILABLE permission_revoked` |
| `ACCESS_BACKGROUND_LOCATION` | guard | checks with the screen off; Android 11+ grants it only in Settings ("Allow all the time") | onboarding card 2 | checks only while the app is open; portal shows "Only while using the app" |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, `FOREGROUND_SERVICE_LOCATION` | both / guard | keep the service alive; declared types for Android 14+ | install-time | — |
| `POST_NOTIFICATIONS` (Android 13+) | both | the permanent status notification | onboarding / first launch | the service still runs; Android hides the notification |
| `RECEIVE_BOOT_COMPLETED` | both | restart after reboot | install-time | — |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | both | the "Allow running in background" prompt | onboarding card 5 | the phone may suspend the app mid-shift |
| `INTERNET`, `ACCESS_NETWORK_STATE`, `WAKE_LOCK` | both | uploads, connectivity detection | install-time | — |

Not requested: microphone, camera, contacts, SMS, storage. The app never records audio. Everything the app collects is listed on the onboarding screen and on the first screen of the operations gateway.

Permission state is reported with every heartbeat (`locationPermission`: `background` / `foreground_only` / `denied`; `callPermission`: `granted` / `partial` / `denied`) and shown on the Devices page, the guard profile and the device compliance report.
