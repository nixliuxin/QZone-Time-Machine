import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Messages } from './pages/Messages';
import { BlogList, BlogDetail } from './pages/Blogs';
import { PhotoAlbums, PhotoAlbumDetail, PhotoView } from './pages/Photos';
import { Videos } from './pages/Videos';
import { Boards } from './pages/Boards';
import { Friends } from './pages/Friends';
import { Favorites } from './pages/Favorites';
import { Shares } from './pages/Shares';
import { DiaryList, DiaryDetail } from './pages/Diaries';
import { Visitors } from './pages/Visitors';
import { About } from './pages/About';
import { DataReport } from './pages/DataReport';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="messages" element={<Messages />} />
        <Route path="blogs" element={<BlogList />} />
        <Route path="blogs/:blogIndex" element={<BlogDetail />} />
        <Route path="diaries" element={<DiaryList />} />
        <Route path="diaries/:diaryIndex" element={<DiaryDetail />} />
        <Route path="photos" element={<PhotoAlbums />} />
        <Route path="photos/:albumId" element={<PhotoAlbumDetail />} />
        <Route path="photos/:albumId/:photoIndex" element={<PhotoView />} />
        <Route path="videos" element={<Videos />} />
        <Route path="boards" element={<Boards />} />
        <Route path="friends" element={<Friends />} />
        <Route path="favorites" element={<Favorites />} />
        <Route path="shares" element={<Shares />} />
        <Route path="visitors" element={<Visitors />} />
        <Route path="about" element={<About />} />
        <Route path="report" element={<DataReport />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
