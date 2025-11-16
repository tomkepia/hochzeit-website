import React from "react";
import AdminPasswordGate from "../components/AdminPasswordGate";
import AdminDashboard from "../components/AdminDashboard";

function AdminPage() {
  return (
    <AdminPasswordGate>
      <AdminDashboard />
    </AdminPasswordGate>
  );
}

export default AdminPage;