import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { Layout } from './components/Layout';
import { Files } from './pages/Files';
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
import { ImageEnhancerPage } from './pages/ImageEnhancerPage';
import { AudioTranscriberPage } from './pages/AudioTranscriberPage';
import { Settings } from './pages/SettingsPage';

function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/chat" replace />} />
            <Route path="chat" element={<></>} />
            <Route path="files" element={<Files />} />
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
            <Route path="tools/image-enhancer/run" element={<ImageEnhancerPage />} />
            <Route path="tools/audio-transcriber/run" element={<AudioTranscriberPage />} />
            <Route path="tools/:id" element={<ToolDetail />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </HashRouter>
    </ThemeProvider>
  );
}

export default App;
