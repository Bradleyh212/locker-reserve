# ADR 0001: Simplify hosting with Docker

Status: accepted direction; deployment pending. Date: 2026-10-02.

Context: AWS/EKS adds operational complexity beyond the current physical-locker prototype needs.

Decision: retain Docker web/API packaging and target a simpler cloud-hosted deployment. A single Docker host is the initial plan; provider, registry and database location remain open. Preserve AWS guidance as legacy history.

Consequences: document HTTPS, persistent storage, migrations, backups and rollback explicitly. A single host has a host-level availability limit; Kubernetes is not a prerequisite. Existing production-named Compose configuration needs changes before cloud use. See [deployment plan](../deployment.md).
