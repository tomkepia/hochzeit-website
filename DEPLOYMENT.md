# 🚀 Wedding Website Deployment Guide

Complete step-by-step guide for deploying your wedding website to Hetzner VPS with automated GitHub Actions CI/CD.

## 📋 Prerequisites

- ✅ Hetzner VPS with Ubuntu 20.04+
- ✅ Domain name with A-Record pointing to your VPS IP
- ✅ GitHub repository (tomkepia/hochzeit-website)
- ✅ SSH access to your VPS

## 🎯 **Part 1: One-Time Server Setup**

### **Step 1: Initial Server Setup**

SSH into your Hetzner VPS and run the automated setup script:

```bash
# SSH into your server
ssh root@your-server-ip

# Download and run the setup script
curl -fsSL https://raw.githubusercontent.com/tomkepia/hochzeit-website/main/scripts/server-setup.sh | bash

# Logout and login again for Docker group changes
exit
ssh root@your-server-ip
```

### **Step 2: Configure Environment Variables**

```bash
cd /opt/hochzeit-website

# Edit the production environment file
nano .env.production

# Update these values:
# - Replace all "yourdomain.com" with your actual domain
# - Set a secure database password
# - Set your email for SSL certificates
```

Example `.env.production`:

```env
POSTGRES_DB=hochzeit_production
POSTGRES_USER=postgres
POSTGRES_PASSWORD=YOUR_SECURE_PASSWORD_HERE
DATABASE_URL=postgresql://postgres:YOUR_SECURE_PASSWORD_HERE@db:5432/hochzeit_production
ENVIRONMENT=production
CORS_ORIGINS=https://your-actual-domain.com,https://www.your-actual-domain.com
REACT_APP_API_URL=https://your-actual-domain.com/api
SSL_EMAIL=your-email@example.com
DOMAIN=your-actual-domain.com
```

### **Step 3: Setup SSL Certificate**

```bash
# Make the script executable
chmod +x scripts/setup-ssl.sh

# Run SSL setup (replace with your actual domain and email)
./scripts/setup-ssl.sh your-actual-domain.com your-email@example.com
```

This will:

- Update nginx configuration with your domain
- Request SSL certificate from Let's Encrypt
- Configure automatic certificate renewal
- Start all services with HTTPS

## 🔧 **Part 2: GitHub Actions Setup**

### **Step 4: Configure GitHub Secrets**

In your GitHub repository, go to Settings → Secrets and variables → Actions, and add:

| Secret Name       | Value                                    | Description                 |
| ----------------- | ---------------------------------------- | --------------------------- |
| `HETZNER_HOST`    | `your-server-ip`                         | Your VPS IP address         |
| `HETZNER_USER`    | `root`                                   | SSH username (usually root) |
| `HETZNER_SSH_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----...` | Your private SSH key        |

#### **Generating SSH Key for GitHub Actions:**

On your local machine:

```bash
# Generate a new SSH key pair
ssh-keygen -t ed25519 -f ~/.ssh/hetzner_deploy -N ""

# Copy the public key to your server
ssh-copy-id -i ~/.ssh/hetzner_deploy.pub root@your-server-ip

# Copy the private key content for GitHub secret
cat ~/.ssh/hetzner_deploy
```

### **Step 5: Enable Container Registry**

The GitHub Actions workflow uses GitHub Container Registry. Make sure:

1. Go to your repository Settings → Actions → General
2. Under "Workflow permissions", select "Read and write permissions"
3. Check "Allow GitHub Actions to create and approve pull requests"

## 🎉 **Part 3: Deploy!**

### **Step 6: Trigger Deployment**

From your local machine:

```bash
# Make any change and push to main branch
git add .
git commit -m "Deploy wedding website"
git push origin main
```

The GitHub Action will:

1. ✅ Run tests for frontend and backend
2. 🐳 Build Docker images
3. 📦 Push images to GitHub Container Registry
4. 🚀 Deploy to your Hetzner VPS
5. 🔄 Restart services with zero downtime

## 🔍 **Monitoring & Troubleshooting**

### **Check Deployment Status:**

```bash
# SSH into your server
ssh root@your-server-ip

# Check running containers
cd /opt/hochzeit-website
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Check specific service logs
docker-compose -f docker-compose.prod.yml logs nginx
docker-compose -f docker-compose.prod.yml logs backend
docker-compose -f docker-compose.prod.yml logs frontend
```

### **Test Your Website:**

```bash
# Test HTTP redirect
curl -I http://your-domain.com

# Test HTTPS
curl -I https://your-domain.com

# Test API
curl https://your-domain.com/api/health
```

### **SSL Certificate Status:**

```bash
# Check certificate expiry
docker-compose -f docker-compose.prod.yml exec certbot \
  certbot certificates
```

## 🛠️ **Common Issues & Solutions**

### **Issue 1: SSL Certificate Failed**

```bash
# Check domain DNS resolution
nslookup your-domain.com

# Manual certificate request
docker-compose -f docker-compose.prod.yml run --rm certbot \
  certbot certonly --webroot --webroot-path /var/www/certbot \
  --email your-email@example.com --agree-tos --no-eff-email \
  -d your-domain.com -d www.your-domain.com
```

### **Issue 2: Database Connection Failed**

```bash
# Check database logs
docker-compose -f docker-compose.prod.yml logs db

# Restart database
docker-compose -f docker-compose.prod.yml restart db
```

### **Issue 3: GitHub Actions Deployment Failed**

- Check the Actions tab in your GitHub repository
- Verify all secrets are correctly set
- Ensure SSH key has proper permissions

## 📱 **Development Workflow**

### **For Future Updates:**

1. **Make changes locally**
2. **Test locally** with `docker-compose up --build`
3. **Commit and push** to main branch
4. **GitHub Actions automatically deploys** to production
5. **Check website** at your domain

### **Rollback if needed:**

```bash
# SSH to server
ssh root@your-server-ip
cd /opt/hochzeit-website

# Check previous images
docker images

# Update docker-compose to use specific tag
# Then restart
docker-compose -f docker-compose.prod.yml up -d
```

## 🎊 **Success Checklist**

- [ ] ✅ Website loads at https://your-domain.com
- [ ] ✅ SSL certificate is valid (green lock in browser)
- [ ] ✅ RSVP form submissions work
- [ ] ✅ All navigation links work
- [ ] ✅ Website is password protected
- [ ] ✅ GitHub Actions deployment works
- [ ] ✅ Certificate auto-renewal is configured

## 📞 **Support**

If you encounter issues:

1. Check the logs: `docker-compose -f docker-compose.prod.yml logs`
2. Verify environment variables: `cat .env.production`
3. Test components individually
4. Check GitHub Actions logs in the repository

---

**🎉 Congratulations! Your wedding website is now live and automatically deployable!**
