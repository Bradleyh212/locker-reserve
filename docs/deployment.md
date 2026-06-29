Locker Reserve Deployment Guide

This guide documents the complete deployment process for Locker Reserve on AWS. It can be used to quickly recreate the environment for demonstrations, interviews, or future development.

⸻

Architecture

The application consists of:

* Next.js frontend
* NestJS backend API
* PostgreSQL database hosted on Amazon RDS
* Redis for server-side caching
* Docker containers
* Amazon ECR for container image storage
* Amazon EKS Kubernetes cluster
* Kubernetes Deployments, Services, and Secrets
* AWS Load Balancers
* Stripe payment integration

⸻

Prerequisites

Install the following tools:

* Docker Desktop
* Node.js
* AWS CLI
* kubectl
* eksctl

Configure AWS credentials:

aws configure

⸻

1. Create Amazon ECR Repositories

aws ecr create-repository \
  --repository-name locker-reserve-api \
  --region ca-central-1
aws ecr create-repository \
  --repository-name locker-reserve-web \
  --region ca-central-1

⸻

2. Login to Amazon ECR

aws ecr get-login-password --region ca-central-1 \
| docker login \
--username AWS \
--password-stdin 512946111274.dkr.ecr.ca-central-1.amazonaws.com

⸻

3. Build & Push Docker Images

API

docker buildx build \
  --platform linux/amd64 \
  -t 512946111274.dkr.ecr.ca-central-1.amazonaws.com/locker-reserve-api:latest \
  services/api \
  --push

Web

Replace API_LOAD_BALANCER_URL with the API Load Balancer hostname after deploying the API.

docker buildx build \
  --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_API_BASE_URL=http://API_LOAD_BALANCER_URL \
  --build-arg NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxx \
  -t 512946111274.dkr.ecr.ca-central-1.amazonaws.com/locker-reserve-web:latest \
  services/web \
  --push

⸻

4. Create Amazon EKS Cluster

eksctl create cluster \
  --name locker-reserve-cluster \
  --region ca-central-1 \
  --nodes 2 \
  --node-type t3.small \
  --managed

Verify:

kubectl get nodes

⸻

5. Create Namespace

kubectl create namespace locker-reserve

⸻

6. Create Amazon RDS PostgreSQL

Create a PostgreSQL database using the AWS Console.

Recommended configuration:

* Engine: PostgreSQL
* Instance class: db.t4g.micro
* Storage: 20 GB
* Public access: Disabled
* Database name: locker
* VPC: Same VPC as the EKS cluster

Allow inbound PostgreSQL traffic (port 5432) from the EKS worker node Security Group.

⸻

7. Create Kubernetes Secrets

kubectl create secret generic locker-api-secrets \
  --namespace locker-reserve \
  --from-literal=DATABASE_URL='postgresql://postgres:PASSWORD@RDS_ENDPOINT:5432/locker?schema=public' \
  --from-literal=ADMIN_EMAIL='admin@example.com' \
  --from-literal=ADMIN_PASSWORD_HASH='BCRYPT_HASH' \
  --from-literal=JWT_SECRET='JWT_SECRET' \
  --from-literal=STRIPE_SECRET_KEY='sk_test_xxxxxxxxx' \
  --from-literal=STRIPE_WEBHOOK_SECRET='whsec_xxxxxxxxx' \
  --from-literal=CORS_ORIGIN='http://WEB_LOAD_BALANCER_URL' \
  --from-literal=REDIS_URL='redis://redis:6379'

⸻

8. Deploy Kubernetes Resources

Deploy every manifest:

kubectl apply -f infra/k8s/

Verify:

kubectl get pods -n locker-reserve
kubectl get svc -n locker-reserve

Wait until every pod reports:

READY   STATUS
1/1     Running

⸻

9. Run Prisma Migrations

Since the RDS instance is private, execute migrations from inside the Kubernetes cluster.

kubectl run prisma-migrate \
  -n locker-reserve \
  --rm -it \
  --image=512946111274.dkr.ecr.ca-central-1.amazonaws.com/locker-reserve-api:latest \
  --restart=Never \
  --env="DATABASE_URL=postgresql://postgres:PASSWORD@RDS_ENDPOINT:5432/locker?schema=public" \
  -- npx prisma migrate deploy

⸻

10. Restart Deployments

kubectl rollout restart deployment locker-api -n locker-reserve
kubectl rollout restart deployment locker-web -n locker-reserve

Verify:

kubectl rollout status deployment locker-api -n locker-reserve
kubectl rollout status deployment locker-web -n locker-reserve

⸻

11. Test the Deployment

View running services:

kubectl get svc -n locker-reserve

The output should include:

* API Load Balancer
* Web Load Balancer

Open the Web Load Balancer URL in your browser.

Test the API:

curl http://API_LOAD_BALANCER_URL

⸻

Cleanup

Delete the Kubernetes cluster:

eksctl delete cluster \
  --name locker-reserve-cluster \
  --region ca-central-1

Delete the RDS instance:

aws rds delete-db-instance \
  --db-instance-identifier locker-reserve-db \
  --skip-final-snapshot \
  --delete-automated-backups \
  --region ca-central-1

Delete the ECR repositories:

aws ecr delete-repository \
  --repository-name locker-reserve-api \
  --force \
  --region ca-central-1
aws ecr delete-repository \
  --repository-name locker-reserve-web \
  --force \
  --region ca-central-1

⸻

Deployment Summary

To redeploy the project:

1. Create ECR repositories.
2. Build and push Docker images.
3. Create the EKS cluster.
4. Create the RDS PostgreSQL instance.
5. Configure RDS networking.
6. Create Kubernetes secrets.
7. Apply the Kubernetes manifests.
8. Run Prisma migrations.
9. Restart the API and Web deployments.
10. Open the Web Load Balancer and verify the application.

Following these steps will recreate the complete Locker Reserve infrastructure from scratch for future demos or interviews.