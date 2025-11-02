# Wedding Website - Docker Setup Guide

A modern wedding website built with React frontend, FastAPI backend, and PostgreSQL database, fully containerized with Docker.

## 🏗️ Architecture

- **Frontend**: React 19.1.1 served with nginx
- **Backend**: FastAPI with SQLAlchemy ORM
- **Database**: PostgreSQL 15
- **Containerization**: Docker & Docker Compose

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Docker Desktop** (latest version)
  - [Download for Mac](https://www.docker.com/products/docker-desktop/)
  - [Download for Windows](https://www.docker.com/products/docker-desktop/)
  - [Download for Linux](https://docs.docker.com/desktop/install/linux-install/)
- **Git** for cloning the repository

### Verify Installation

```bash
# Check Docker installation
docker --version
docker-compose --version

# Ensure Docker Desktop is running
docker info
```

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/tomkepia/hochzeit-website.git
cd hochzeit-website
```

### 2. Start the Application

```bash
# Build and start all services
docker-compose up --build -d
```

This command will:

- Pull the PostgreSQL image
- Build the React frontend
- Build the FastAPI backend
- Start all services in detached mode

### 3. Access the Application

Once the containers are running, you can access:

- **Wedding Website**: http://localhost:3000
- **API Documentation**: http://localhost:8000/docs
- **API Health Check**: http://localhost:8000
- **Database**: localhost:5432 (postgres/password)

## 📁 Project Structure

```
hochzeit-website/
├── README.md
├── docker-compose.yml          # Multi-service orchestration
├── Dockerfile                  # Frontend container definition
├── .dockerignore              # Frontend build exclusions
├── package.json               # React dependencies
├── public/                    # Static React assets
├── src/                       # React source code
│   ├── components/           # React components
│   │   ├── InfoSection.js
│   │   ├── PasswordGate.js
│   │   ├── PhotoUploadSection.js
│   │   └── RSVPForm.js
│   └── ...
└── backend/                   # FastAPI backend
    ├── Dockerfile            # Backend container definition
    ├── .dockerignore         # Backend build exclusions
    ├── requirements.txt      # Python dependencies
    ├── main.py              # FastAPI application
    ├── database.py          # Database configuration
    ├── models.py            # SQLAlchemy models
    └── __init__.py
```

## 🐳 Docker Services

### Database Service (`db`)

- **Image**: `postgres:15-alpine`
- **Port**: `5432:5432`
- **Environment**:
  - `POSTGRES_DB=hochzeit_db`
  - `POSTGRES_USER=postgres`
  - `POSTGRES_PASSWORD=password`
- **Volume**: `postgres_data` for data persistence

### Backend Service (`backend`)

- **Build**: `./backend/Dockerfile`
- **Port**: `8000:8000`
- **Dependencies**: Database must be healthy
- **Features**: Hot reload enabled for development

### Frontend Service (`frontend`)

- **Build**: `./Dockerfile` (multi-stage build)
- **Port**: `3000:80`
- **Dependencies**: Backend service
- **Served by**: nginx

## 🛠️ Development Workflow

### Starting Development

```bash
# Start all services with logs visible
docker-compose up --build

# Start in detached mode (background)
docker-compose up --build -d
```

### Making Changes

#### Backend Changes (Python/FastAPI)

The backend has hot reload enabled, so changes are automatically detected:

```bash
# If hot reload doesn't work, restart backend only
docker-compose restart backend
```

#### Frontend Changes (React)

For frontend changes, you need to rebuild:

```bash
# Rebuild only frontend
docker-compose up --build frontend -d

# Or full rebuild
docker-compose down
docker-compose up --build -d
```

### Viewing Logs

```bash
# View all logs
docker-compose logs

# View specific service logs
docker-compose logs backend
docker-compose logs frontend
docker-compose logs db

# Follow logs in real-time
docker-compose logs -f backend
```

### Checking Service Status

```bash
# List running containers
docker-compose ps

# Check container health
docker-compose ps --format "table {{.Name}}\\t{{.Status}}\\t{{.Ports}}"
```

## 🔧 Common Commands

### Container Management

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (⚠️ deletes database data)
docker-compose down -v

# Restart specific service
docker-compose restart backend

# Rebuild without cache
docker-compose build --no-cache
docker-compose up -d
```

### Database Operations

```bash
# Access PostgreSQL CLI
docker-compose exec db psql -U postgres -d hochzeit_db

# View database tables
docker-compose exec db psql -U postgres -d hochzeit_db -c "\\dt"

# Backup database
docker-compose exec db pg_dump -U postgres hochzeit_db > backup.sql

# Restore database
docker-compose exec -T db psql -U postgres -d hochzeit_db < backup.sql
```

### Debugging

```bash
# Execute commands inside containers
docker-compose exec backend bash
docker-compose exec frontend sh

# View container resource usage
docker stats

# Inspect container configuration
docker inspect hochzeit-website-backend-1
```

## 🌍 Environment Configuration

### Default Configuration

The application uses these default settings:

```env
POSTGRES_DB=hochzeit_db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
DATABASE_URL=postgresql://postgres:password@db:5432/hochzeit_db
```

### Production Configuration

For production, create a `.env` file:

```bash
# Copy example environment file
cp .env.example .env

# Edit with your production values
nano .env
```

Example `.env` file:

```env
POSTGRES_DB=hochzeit_production
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password_here
DATABASE_URL=postgresql://postgres:your_secure_password_here@db:5432/hochzeit_production
ENVIRONMENT=production
```

Then reference it in `docker-compose.yml`:

```yaml
services:
  backend:
    env_file: .env
  db:
    env_file: .env
```

## 🚨 Troubleshooting

### Common Issues

#### 1. Docker Daemon Not Running

```bash
# Error: Cannot connect to Docker daemon
# Solution: Start Docker Desktop application
open -a Docker  # macOS
```

#### 2. Port Already in Use

```bash
# Error: Port 3000/8000/5432 already in use
# Solution: Stop conflicting services or change ports in docker-compose.yml
lsof -ti:3000 | xargs kill -9  # Kill process on port 3000
```

#### 3. Permission Denied

```bash
# Error: Permission denied
# Solution: Ensure Docker Desktop is running and you have permissions
sudo usermod -aG docker $USER  # Linux only
```

#### 4. Import Errors in Backend

```bash
# Error: ModuleNotFoundError
# Solution: Check import paths in Python files (use relative imports)
# Rebuild backend container
docker-compose up --build backend -d
```

#### 5. Database Connection Failed

```bash
# Check database health
docker-compose ps db

# View database logs
docker-compose logs db

# Restart database
docker-compose restart db
```

### Getting Help

1. **Check service logs**: `docker-compose logs [service-name]`
2. **Verify all services are running**: `docker-compose ps`
3. **Test individual endpoints**:
   ```bash
   curl http://localhost:8000/
   curl http://localhost:3000/
   ```

## 🚀 Deployment

### Local Production Build

```bash
# Build for production
docker-compose -f docker-compose.prod.yml up --build -d
```

### Cloud Deployment

This Docker setup is compatible with:

- **AWS ECS/Fargate**
- **Google Cloud Run**
- **Azure Container Instances**
- **DigitalOcean App Platform**
- **Heroku Container Registry**

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Test with Docker: `docker-compose up --build`
5. Commit changes: `git commit -am 'Add feature'`
6. Push to branch: `git push origin feature-name`
7. Submit a Pull Request

## 📝 API Endpoints

### Backend API (FastAPI)

| Method | Endpoint | Description       |
| ------ | -------- | ----------------- |
| GET    | `/`      | Health check      |
| POST   | `/rsvp`  | Submit RSVP form  |
| GET    | `/docs`  | API documentation |

### RSVP Form Data Structure

```json
{
  "name": "string",
  "essenswunsch": "string",
  "dabei": true,
  "email": "string",
  "anreise": "string",
  "essen_fr": true,
  "essen_sa": true,
  "essen_so": true,
  "essen_mitbringsel": "string",
  "unterkunft": "string"
}
```

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 👥 Authors

- **JP Briem** - Initial work and Docker configuration

---

**Note**: This is a wedding website template. Customize the content, styling, and functionality according to your needs.
