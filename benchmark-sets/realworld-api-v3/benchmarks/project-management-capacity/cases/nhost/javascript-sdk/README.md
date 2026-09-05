# Nhost project-management capacity

This case runs the authenticated project-management workload through Nhost's official `@nhost/nhost-js@4.8.0` client. Measured operations use native email/password sessions and authenticated Hasura GraphQL requests; SQL and Hasura metadata administration remain outside measurement.

GraphQL variables carry all tenant, filter, search, and pagination inputs. Hasura permissions use the authenticated user ID and organization memberships, while mutations return the normalized task/comment contract and activity triggers feed dashboard reads. Each virtual user gets an isolated Nhost client and session with refresh/sign-out handling and request timeouts.

Nhost's GraphQL/Hasura access path and JWT permission claims are retained as the case's platform-specific behavior.
