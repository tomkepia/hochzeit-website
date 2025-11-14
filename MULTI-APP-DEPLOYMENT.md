# 🔗 Multi-App Server Deployment Guide

This guide is for deploying the wedding website on a server that already has other applications running.

## 🎯 **Scenario: Server with Existing Applications**

If your Hetzner VPS already has:

- ✅ Another Docker application running
- ✅ Nginx already installed and serving another site
- ✅ Ports 80/443 already in use

## 🚀 **Solution: Shared Infrastructure Setup**

### **Architecture Overview:**

```
Internet → Your Nginx → Wedding App (localhost:3001/8001)
         → Your Nginx → Other App (existing setup)
```

### **Step 1: Run Multi-App Setup Script**

```bash
# SSH into your server
ssh root@your-server-ip

# Run the multi-app setup script
curl -fsSL https://raw.githubusercontent.com/tomkepia/hochzeit-website/main/scripts/multi-app-setup.sh | bash
```

### **Step 2: Configure Your Domain**

Edit the nginx configuration:

```bash
# Edit the wedding website nginx config
sudo nano /etc/nginx/sites-available/hochzeit-website

# Replace DOMAIN_PLACEHOLDER with your actual domain
# Example: hochzeit-tomke-jp.de
```

### **Step 3: Enable the Site**

```bash
# Enable the wedding website
sudo ln -s /etc/nginx/sites-available/hochzeit-website /etc/nginx/sites-enabled/

# Test nginx configuration
sudo nginx -t

# If test passes, reload nginx
sudo systemctl reload nginx
```

### **Step 4: Configure Environment Variables**

```bash
cd /opt/hochzeit-website

# Edit production environment
nano .env.production

# Update with your values:
# - Domain name
# - Database password
# - Email for notifications
```

### **Step 5: Start Wedding App Containers**

```bash
# Start the wedding app (using shared-server compose file)
docker-compose -f docker-compose.prod-shared.yml up -d

# Check status
docker-compose -f docker-compose.prod-shared.yml ps
```

## 🔧 **Port Allocation**

Your wedding website will use these localhost-only ports:

| Service     | Port | Access                |
| ----------- | ---- | --------------------- |
| Frontend    | 3001 | http://localhost:3001 |
| Backend API | 8001 | http://localhost:8001 |
| Database    | 5433 | localhost:5433        |

**Note:** These ports are only accessible from localhost for security.

## 🔍 **SSL Certificate Management**

### **Option A: Use Your Existing SSL Setup**

If you already have Let's Encrypt/Certbot:

```bash
# Add your wedding domain to existing certificate
sudo certbot --nginx -d your-wedding-domain.com
```

### **Option B: Separate SSL Management**

If you want separate SSL management:

```bash
# Request certificate for wedding domain only
sudo certbot certonly --webroot --webroot-path /var/www/html \
  -d your-wedding-domain.com -d www.your-wedding-domain.com
```

## 🔄 **GitHub Actions for Multi-App Setup**

Update your GitHub Actions secrets:

| Secret         | Value                            | Note                          |
| -------------- | -------------------------------- | ----------------------------- |
| `COMPOSE_FILE` | `docker-compose.prod-shared.yml` | Use shared version            |
| `NGINX_RELOAD` | `true`                           | Reload nginx after deployment |

## 🛠️ **Troubleshooting**

### **Check if Services are Running:**

```bash
# Check docker containers
docker-compose -f docker-compose.prod-shared.yml ps

# Check nginx status
sudo systemctl status nginx

# Check port usage
sudo ss -tuln | grep -E ':(80|443|3001|8001|5433)'
```

### **View Logs:**

```bash
# Wedding app logs
docker-compose -f docker-compose.prod-shared.yml logs -f

# Nginx logs
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

### **Test Connectivity:**

```bash
# Test backend directly
curl http://localhost:8001/health

# Test frontend directly
curl http://localhost:3001

# Test through nginx
curl https://your-wedding-domain.com/api/health
```

## ⚠️ **Resource Considerations**

### **Memory Usage:**

- Wedding app: ~200-300MB RAM
- Your existing app: varies
- **Recommendation:** Ensure at least 1GB free RAM

### **Disk Space:**

- Docker images: ~500MB
- Database: starts small, grows with RSVPs
- **Recommendation:** Monitor with `df -h`

### **CPU Usage:**

- Wedding app is lightweight
- Peak usage during deployments
- **Recommendation:** Monitor with `htop`

## 🔐 **Security Considerations**

### **Firewall Rules:**

```bash
# Only allow nginx ports (your existing setup should handle this)
sudo ufw status

# Ensure internal ports are not exposed
sudo ufw deny 3001
sudo ufw deny 8001
sudo ufw deny 5433
```

### **Docker Network Isolation:**

- Wedding app uses isolated `hochzeit-network`
- No cross-contamination with other apps
- Database only accessible within wedding app network

## 🎉 **Benefits of This Setup**

✅ **No port conflicts** - Uses different internal ports  
✅ **Shared nginx** - One reverse proxy for all apps  
✅ **Isolated networks** - Apps don't interfere with each other  
✅ **Resource efficient** - Shared system resources  
✅ **Easy maintenance** - One server, multiple apps  
✅ **SSL flexibility** - Use existing or separate certificates

## 📞 **Need Help?**

If you encounter issues:

1. **Check nginx config:** `sudo nginx -t`
2. **Check docker logs:** `docker-compose -f docker-compose.prod-shared.yml logs`
3. **Check port conflicts:** `sudo ss -tuln`
4. **Verify file permissions:** `ls -la /opt/hochzeit-website/`

---

**🎊 Your wedding website can coexist peacefully with your other applications!**
