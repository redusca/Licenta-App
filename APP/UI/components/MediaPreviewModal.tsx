import React, { useState, useRef, useEffect } from 'react';
import { X, RotateCw, ZoomIn, ZoomOut, Maximize, Play, Pause, FastForward } from 'lucide-react';

interface FileItem {
    name: string;
    path: string;
    size: number;
    is_dir: boolean;
}

interface MediaPreviewModalProps {
    file: FileItem;
    onClose: () => void;
}

const API_URL = 'http://127.0.0.1:5000/api/drive/file';

export const MediaPreviewModal: React.FC<MediaPreviewModalProps> = ({ file, onClose }) => {
    const [rotation, setRotation] = useState(0);
    const [scale, setScale] = useState(1);
    const [playbackRate, setPlaybackRate] = useState(1);
    const videoRef = useRef<HTMLVideoElement>(null);

    const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(file.name);
    const src = `${API_URL}?path=${encodeURIComponent(file.path)}`;

    // Reset state when file changes
    useEffect(() => {
        setRotation(0);
        setScale(1);
        setPlaybackRate(1);
    }, [file]);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.playbackRate = playbackRate;
        }
    }, [playbackRate]);

    const handleRotate = () => setRotation(r => r + 90);
    const handleZoomIn = () => setScale(s => Math.min(s + 0.5, 5));
    const handleZoomOut = () => setScale(s => Math.max(s - 0.5, 0.5));
    
    const toggleSpeed = () => {
        const rates = [1, 1.5, 2];
        const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
        setPlaybackRate(next);
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur flex flex-col animate-in fade-in duration-200" onClick={onClose}>
            {/* Toolbar */}
            <div className="flex items-center justify-between p-4 text-white bg-black/50" onClick={e => e.stopPropagation()}>
                <div className="font-medium truncate max-w-xl">{file.name}</div>
                <div className="flex items-center gap-4">
                    {!isVideo && (
                        <>
                            <button onClick={handleRotate} className="p-2 hover:bg-white/20 rounded-full transition-colors" title="Rotate">
                                <RotateCw className="w-5 h-5" />
                            </button>
                            <div className="flex bg-white/10 rounded-lg">
                                <button onClick={handleZoomOut} className="p-2 hover:bg-white/20 rounded-l-lg transition-colors" title="Zoom Out">
                                    <ZoomOut className="w-5 h-5" />
                                </button>
                                <span className="flex items-center px-2 text-sm font-mono min-w-[3rem] justify-center">{Math.round(scale * 100)}%</span>
                                <button onClick={handleZoomIn} className="p-2 hover:bg-white/20 rounded-r-lg transition-colors" title="Zoom In">
                                    <ZoomIn className="w-5 h-5" />
                                </button>
                            </div>
                        </>
                    )}
                    {isVideo && (
                        <button onClick={toggleSpeed} className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors font-mono text-sm" title="Playback Speed">
                            <FastForward className="w-4 h-4" />
                            {playbackRate}x
                        </button>
                    )}
                    <div className="w-px h-6 bg-white/20 mx-2" />
                    <button onClick={onClose} className="p-2 hover:bg-red-500/80 rounded-full transition-colors" title="Close">
                        <X className="w-6 h-6" />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex items-center justify-center p-8 overflow-hidden" onClick={onClose}>
                <div className="relative w-full h-full flex items-center justify-center" onClick={e => e.stopPropagation()}>
                    {isVideo ? (
                        <video
                            ref={videoRef}
                            src={src}
                            controls
                            className="max-w-full max-h-full rounded shadow-2xl focus:outline-none"
                            autoPlay
                        />
                    ) : (
                        <img
                            src={src}
                            alt={file.name}
                            className="max-w-full max-h-full transition-transform duration-200 ease-out"
                            style={{ transform: `rotate(${rotation}deg) scale(${scale})` }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};
