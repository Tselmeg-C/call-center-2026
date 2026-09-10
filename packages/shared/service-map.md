# Sales service mapping

| Service method | Operation | Role | Mutation metadata |
|---|---|---|---|
| `signIn` | `POST /session/login` (`login`) | Public | Dedicated session semantics |
| `signOut` | `POST /session/logout` (`logout`) | Authenticated | Safe when already signed out |
| `currentUser` | `GET /session/me` (`currentUser`) | Authenticated | — |
| `listCustomers` | `GET /customers` (`listCustomers`) | Sales/Admin | `page`, `page_size`, filters |
| `getCustomer` | `GET /customers/{bcn}` (`getCustomer`) | Sales/Admin | — |
| `workload` | `GET /workload` (`workload`) | Sales | UTC bucket snapshot |
| `createFollowUp` | `POST /customers/{bcn}/follow-ups` (`createFollowUp`) | Owner/Admin | `submissionId` |
| `updateFollowUp` | `PATCH /customers/{bcn}/follow-ups/{followUpId}` (`updateFollowUp`) | Owner/Admin | `submissionId`, expected version |
| `cancelFollowUp` | `DELETE /customers/{bcn}/follow-ups/{followUpId}` (`cancelFollowUp`) | Owner/Admin | `submissionId` |
| `completeFollowUp` | `POST /customers/{bcn}/follow-ups/{followUpId}/complete` (`completeFollowUp`) | Owner/Admin | `submissionId` |
| `createInteraction` | `POST /customers/{bcn}/interactions` (`createInteraction`) | Owner/Admin | `submissionId` |
| `createNote` | `POST /customers/{bcn}/notes` (`createNote`) | Owner/Admin | `submissionId` |
| `deleteHistory` | `DELETE /customers/{bcn}/history/{id}` (`deleteHistory`) | Owner/Admin | Tombstone response |
| `closeCustomer` | `POST /customers/{bcn}/close` (`closeCustomer`) | Owner/Admin | `submissionId`, expected state |
| `reopenCustomer` | `POST /customers/{bcn}/reopen` (`reopenCustomer`) | Owner/Admin | `submissionId` |

Mock-only scenario, reset, and persona controls have no production endpoint. Sessions are opaque HttpOnly cookies in the eventual backend; examples never contain credential or session values. Unsafe requests require an allowed Origin, and mutation IDs are actor/operation scoped for retry idempotency.
