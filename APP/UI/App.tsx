import { HashRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Chat } from './pages/Chat';
import { Files } from './pages/Files';
import { Extensions } from './pages/Extensions';
import { Tools } from './pages/Tools';
import { ToolDetail } from './pages/ToolDetail';
import { ImageConverterPage } from './pages/ImageConverterPage';
import { RemoveBackgroundPage } from './pages/RemoveBackgroundPage';
import { ImageToSvgPage } from './pages/ImageToSvgPage';
import { VideoConverterPage } from './pages/VideoConverterPage';
import { VideoCompressorPage } from './pages/VideoCompressorPage';
import { AudioConverterPage } from './pages/AudioConverterPage';
import { ThreeDVisualizerPage } from './pages/ThreeDVisualizerPage';
import { DriveCreatorPage } from './pages/DriveCreatorPage';
import { SpaceAnalyzerPage } from './pages/SpaceAnalyzerPage';
import { PdfMergerPage } from './pages/PdfMergerPage';
import { ModelConverterPage } from './pages/ModelConverterPage';
import { DocumentConverterPage } from './pages/DocumentConverterPage';
import { Settings } from './pages/SettingsPage';

function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="chat" element={<Chat />} />
            <Route path="files" element={<Files />} />
            <Route path="extensions" element={<Extensions />} />
            <Route path="tools" element={<Tools />} />
            <Route path="tools/image-converter/run" element={<ImageConverterPage />} />
            <Route path="tools/remove-background/run" element={<RemoveBackgroundPage />} />
            <Route path="tools/image-to-svg/run" element={<ImageToSvgPage />} />
            <Route path="tools/video-converter/run" element={<VideoConverterPage />} />
            <Route path="tools/video-compressor/run" element={<VideoCompressorPage />} />
            <Route path="tools/audio-converter/run" element={<AudioConverterPage />} />
            <Route path="tools/3d-visualizer/run" element={<ThreeDVisualizerPage />} />
            <Route path="tools/drive-creator/run" element={<DriveCreatorPage />} />
            <Route path="tools/space-analyzer/run" element={<SpaceAnalyzerPage />} />
            <Route path="tools/pdf-merger/run" element={<PdfMergerPage />} />
            <Route path="tools/model-converter/run" element={<ModelConverterPage />} />
            <Route path="tools/document-converter/run" element={<DocumentConverterPage />} />
            <Route path="tools/:id" element={<ToolDetail />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </HashRouter>
    </ThemeProvider>
  );
}

export default App;
