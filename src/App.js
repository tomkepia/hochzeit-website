import React from "react";
import { Routes, Route } from "react-router-dom";
import "./App.css";
import MainPage from "./pages/MainPage";
import AdminPage from "./pages/AdminPage";
import UploadPage from "./pages/UploadPage";
import PhotosPage from "./pages/PhotosPage";
import GalleryEntryPage from "./pages/GalleryEntryPage";

function App() {
  return (
    <div className="App">
      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/gallery" element={<GalleryEntryPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/photos" element={<PhotosPage />} />
      </Routes>
    </div>
  );
}

export default App;