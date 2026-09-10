# Authentication policy

The prototype uses email/password sign-in in the eventual backend. Sessions are absolute for eight hours; logout, password reset, deactivation, and role changes revoke the current session. Failed login responses are generic. There is no public registration: an operator provisions the initial Admin and recovers passwords through a command that reads secret input without echoing it. Mock screens request no passwords and contain synthetic personas only.
