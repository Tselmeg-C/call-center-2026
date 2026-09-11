# MVP backlog

Based on the enterprise Sales customer-contact management MVP plan. Delivery order: frontend design in `apps/frontend` → OpenAPI derived from frontend services → connected and tested backend → durable persistence → deployment.

The frontend stack is TanStack Start/React/TypeScript; the backend remains FastAPI, PostgreSQL, SQLAlchemy/Alembic, and Railway. Each item is a focused GitHub issue intended for one working session; later stages depend on established project artifacts, but descriptions provide enough context for separate handoffs. Use synthetic data and never expose credentials; embedded telephony and future integrations are outside MVP scope.


Tasks have moved to GitHub issues. The links below preserve the implementation order; GitHub is the source of truth for task descriptions and status.

1. [Set up an empty project with a passing test](https://github.com/Tselmeg-C/call-center-2026/issues/1)
2. [Add the mock service layer and application shell](https://github.com/Tselmeg-C/call-center-2026/issues/2)
3. [Build customer browsing and detail views](https://github.com/Tselmeg-C/call-center-2026/issues/3)
4. [Build interaction and note workflows](https://github.com/Tselmeg-C/call-center-2026/issues/4)
5. [Build follow-up and customer lifecycle workflows](https://github.com/Tselmeg-C/call-center-2026/issues/5)
6. [Build the Sales workload dashboard](https://github.com/Tselmeg-C/call-center-2026/issues/6)
7. [Build Admin user and closure-reason settings](https://github.com/Tselmeg-C/call-center-2026/issues/7)
8. [Build the Excel import experience](https://github.com/Tselmeg-C/call-center-2026/issues/8)
9. [Build Admin assignment workflows](https://github.com/Tselmeg-C/call-center-2026/issues/9)
10. [Build Admin reporting and audit views](https://github.com/Tselmeg-C/call-center-2026/issues/10)
11. [Derive the Sales OpenAPI contract](https://github.com/Tselmeg-C/call-center-2026/issues/11)
12. [Complete and enforce the Admin OpenAPI contract](https://github.com/Tselmeg-C/call-center-2026/issues/12)
13. [Establish the backend and authentication](https://github.com/Tselmeg-C/call-center-2026/issues/13)
14. [Implement customer reads, ownership, and access control](https://github.com/Tselmeg-C/call-center-2026/issues/14)
15. [Implement user and closure-reason administration](https://github.com/Tselmeg-C/call-center-2026/issues/15)
16. [Implement interactions and notes](https://github.com/Tselmeg-C/call-center-2026/issues/16)
17. [Implement follow-ups and customer lifecycle](https://github.com/Tselmeg-C/call-center-2026/issues/17)
18. [Implement Excel ingestion](https://github.com/Tselmeg-C/call-center-2026/issues/18)
19. [Implement configurable assignment](https://github.com/Tselmeg-C/call-center-2026/issues/19)
20. [Implement workload, reporting, and audit queries](https://github.com/Tselmeg-C/call-center-2026/issues/20)
21. [Connect and test the application against the backend](https://github.com/Tselmeg-C/call-center-2026/issues/21)
22. [Add PostgreSQL infrastructure and persist identities](https://github.com/Tselmeg-C/call-center-2026/issues/22)
23. [Persist customer master data and import results](https://github.com/Tselmeg-C/call-center-2026/issues/23)
24. [Persist ownership, assignment rules, and audit history](https://github.com/Tselmeg-C/call-center-2026/issues/24)
25. [Persist interaction, follow-up, and lifecycle history](https://github.com/Tselmeg-C/call-center-2026/issues/25)
26. [Switch to persistence and verify application parity](https://github.com/Tselmeg-C/call-center-2026/issues/26)
27. [Harden runtime behavior and deploy development](https://github.com/Tselmeg-C/call-center-2026/issues/27)
28. [Validate recovery and release production](https://github.com/Tselmeg-C/call-center-2026/issues/28)
