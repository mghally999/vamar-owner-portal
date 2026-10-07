# Firebase Auth emulator

Project id `demo-vamar`. Any project id starting with `demo-` is emulator-only and never
touches a real Firebase project, so no credentials are needed.

- Auth emulator: http://localhost:9099
- Emulator UI (see OTP codes, create users): http://localhost:4000

Phone sign-in in the emulator never sends SMS. The verification code is printed in the
emulator UI and in `docker compose logs firebase`. Test phone numbers for the seed owners are
listed in PROJECT.md.
