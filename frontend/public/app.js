const { useState, useEffect, useRef } = React;

function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStep, setUploadStep] = useState('');
  const [searchProgress, setSearchProgress] = useState(0);
  const [searchStep, setSearchStep] = useState('');
  const [activeTab, setActiveTab] = useState('text'); // 'text' or 'metadata'
  const [hoveredBlockIndex, setHoveredBlockIndex] = useState(null);
  const [highlightedBlocks, setHighlightedBlocks] = useState([]);

  const fileInputRef = useRef(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const imgRef = useRef(null);

  const updateImageSize = () => {
    if (imgRef.current) {
      setImageSize({
        width: imgRef.current.clientWidth,
        height: imgRef.current.clientHeight
      });
    }
  };

  useEffect(() => {
    window.addEventListener('resize', updateImageSize);
    return () => window.removeEventListener('resize', updateImageSize);
  }, []);

  useEffect(() => {
    const timer = setTimeout(updateImageSize, 100);
    return () => clearTimeout(timer);
  }, [selectedDoc]);

  // Fetch documents on load
  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      setDocuments(data);
      if (data.length > 0) {
        setSelectedDoc(data[0]);
      }
    } catch (err) {
      console.error('Error fetching documents:', err);
    } finally {
      setLoading(false);
    }
  };

  // Perform RAG search
  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    setSearchResult(null);
    setHighlightedBlocks([]);
    setSearchProgress(5);
    setSearchStep('Deconstructing query and parsing intent...');

    // Progress Simulation Interval
    let progress = 5;
    const interval = setInterval(() => {
      if (progress < 90) {
        progress += Math.floor(Math.random() * 8) + 4;
        if (progress > 90) progress = 90;
        
        // Update step message based on progress bracket
        if (progress < 25) {
          setSearchStep('Analyzing query keywords and preparing vector space...');
        } else if (progress < 55) {
          setSearchStep('Retrieving high-fidelity context blocks and coordinates...');
        } else if (progress < 80) {
          setSearchStep('Generating semantic response with gemma4:e2b...');
        } else {
          setSearchStep('Formatting structured answer, metadata, and citation overlays...');
        }
        
        setSearchProgress(progress);
      }
    }, 150);

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery })
      });
      const data = await res.json();

      clearInterval(interval);
      setSearchProgress(100);
      setSearchStep('Done! Semantic answer and citation overlays successfully rendered.');

      setTimeout(() => {
        setSearchResult(data);

        // If citations exist, highlight blocks matching the first citation
        if (data.citations && data.citations.length > 0) {
          const firstCitation = data.citations[0];
          // Find corresponding document
          const doc = documents.find(d => d.fileName === firstCitation.fileName);
          if (doc) {
            setSelectedDoc(doc);
            if (firstCitation.matching_blocks) {
              setHighlightedBlocks(firstCitation.matching_blocks);
            }
          }
        }
        // Clear search progress display
        setSearchProgress(0);
      }, 500);

    } catch (err) {
      clearInterval(interval);
      console.error('Error performing RAG search:', err);
      setSearchStep(`RAG Search Error: ${err.message}`);
      setSearchProgress(100);
      setTimeout(() => {
        setSearchProgress(0);
      }, 2500);
    } finally {
      setLoading(false);
    }
  };

  // Simulate OCR pipeline upload for the GDG demo
  const handleUploadClick = () => {
    fileInputRef.current.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Support actual image rendering on the frontend canvas
    const isImage = file.type.startsWith('image/');
    const objectUrl = isImage ? URL.createObjectURL(file) : null;

    if (isImage) {
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        console.log(`[Frontend Image Loaded] Width: ${width}, Height: ${height}`);
        
        const reader = new FileReader();
        reader.onload = () => {
          const base64Data = reader.result.split(',')[1];
          simulateOcrPipeline(file.name, objectUrl, base64Data, file.type, width, height);
        };
        reader.readAsDataURL(file);
      };
      img.src = objectUrl;
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const base64Data = reader.result.split(',')[1];
        simulateOcrPipeline(file.name, objectUrl, base64Data, file.type, 0, 0);
      };
      reader.readAsDataURL(file);
    }
  };

  const simulateOcrPipeline = (originalName, objectUrl, base64Data, mimeType, width = 0, height = 0) => {
    setUploading(true);
    setUploadProgress(0);
    setUploadStep('Connecting to Google Cloud Storage...');

    // Step 1: Upload to GCS Input Bucket
    setTimeout(() => {
      setUploadProgress(25);
      setUploadStep('Uploading image to gs://gdg-bulk-ocr-input...');
      
      // Step 2: GCS triggers Pub/Sub
      setTimeout(() => {
        setUploadProgress(50);
        setUploadStep('GCS triggered Event: Publishing to Pub/Sub topic "bulk-ocr-uploads"...');
        
        // Step 3: Pub/Sub push to Cloud Run
        setTimeout(() => {
          setUploadProgress(75);
          setUploadStep('Pub/Sub Push subscription forwarding event to Cloud Run subscriber...');
          
          // Step 4: Cloud Run running OCR via Gemma 4 and writing output
          setTimeout(() => {
            setUploadProgress(95);
            setUploadStep('Cloud Run executing Gemma-4 Model via ADK: Extracting high-fidelity text & metadata...');
            
            setTimeout(async () => {
              try {
                // POST file base64 payload to backend OCR service
                const response = await fetch('/api/upload', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    fileName: originalName,
                    title: originalName.split('.')[0],
                    base64Data: base64Data,
                    mimeType: mimeType,
                    width: width,
                    height: height
                  })
                });

                if (!response.ok) {
                  throw new Error(`Server returned HTTP ${response.status}`);
                }

                const data = await response.json();
                if (!data.success || !data.doc) {
                  throw new Error(data.error || 'Failed to process document OCR.');
                }

                const newDoc = {
                  ...data.doc,
                  objectUrl: objectUrl // Incorporate local object URL for preview rendering
                };

                setUploadProgress(100);
                setUploadStep('Success! Extracted text and structured metadata written to gs://gdg-bulk-ocr-output.');

                setDocuments(prev => [newDoc, ...prev]);
                setSelectedDoc(newDoc);

              } catch (err) {
                console.error('Error during backend OCR process:', err);
                setUploadStep(`OCR Pipeline Error: ${err.message}`);
                setUploadProgress(100);
              } finally {
                // End upload state
                setTimeout(() => {
                  setUploading(false);
                }, 2000);
              }
            }, 1000);
          }, 1500);
        }, 1500);
      }, 1200);
    }, 1200);
  };

  // Check if a block is highlighted from search citations
  const isBlockHighlighted = (block) => {
    return highlightedBlocks.some(hb => 
      hb.text.toLowerCase().includes(block.text.toLowerCase()) || 
      block.text.toLowerCase().includes(hb.text.toLowerCase())
    );
  };

  // Trigger when a citation item is clicked
  const handleCitationClick = (citation) => {
    const doc = documents.find(d => d.fileName === citation.fileName);
    if (doc) {
      setSelectedDoc(doc);
      if (citation.matching_blocks) {
        setHighlightedBlocks(citation.matching_blocks);
      }
    }
  };

  return (
    <div className="app-container">
      {/* GDG Google Style Header */}
      <header>
        <div className="logo-group">
          <div className="google-dots">
            <span className="dot blue"></span>
            <span className="dot red"></span>
            <span className="dot yellow"></span>
            <span className="dot green"></span>
          </div>
          <div className="title-wrapper">
            <h1 className="brand-text">
              Massive OCR at the Edge <span className="brand-badge gdg-summit">GDG Lisbon - GenAI Community</span>
            </h1>
            <p className="session-speaker">
              <i className="fa-solid fa-user-tie"></i> Speaker: <strong>Nuno Andrade</strong> (Cloud Platform Expert)
            </p>
          </div>
        </div>
        <div className="gdg-badge presentation-mode">
          <i className="fa-solid fa-wand-magic-sparkles" style={{color: 'var(--google-blue)'}}></i>
          Powered by Gemma 4 &amp; ADK
        </div>
      </header>

      {/* Main Grid */}
      <div className="dashboard-grid">
        {/* Sidebar Panel */}
        <div className="sidebar">
          {/* Upload Interactive Zone */}
          <div className="glass-panel">
            <h2 className="panel-title">
              <i className="fa-solid fa-cloud-arrow-up" style={{color: 'var(--google-blue)'}}></i>
              Upload GCS Document
            </h2>
            <div className="upload-zone" onClick={handleUploadClick}>
              <i className="fa-solid fa-file-invoice upload-icon"></i>
              <p className="upload-text">
                Drag & drop or <span>Browse files</span>
              </p>
              <p style={{fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px'}}>
                Triggers Pub/Sub → Cloud Run OCR
              </p>
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden-input" 
              accept="image/*"
              onChange={handleFileChange}
            />
          </div>

          {/* Document list */}
          <div className="glass-panel" style={{flex: 1}}>
            <h2 className="panel-title">
              <i className="fa-solid fa-folder-open" style={{color: 'var(--google-green)'}}></i>
              Digitized Library
            </h2>
            {loading && documents.length === 0 ? (
              <div style={{textAlign: 'center', padding: '2rem'}}>
                <div className="spinner" style={{width: '24px', height: '24px', margin: '0 auto'}}></div>
                <p style={{fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '8px'}}>Scanning GCS Output...</p>
              </div>
            ) : (
              <div className="doc-list">
                {documents.map((doc, idx) => (
                  <div 
                    key={idx} 
                    className={`doc-item ${selectedDoc?.fileName === doc.fileName ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedDoc(doc);
                      setHighlightedBlocks([]);
                    }}
                  >
                    <div className="doc-title">{doc.title}</div>
                    <div className="doc-meta">
                      <span>{doc.metadata?.creation_date || 'Unknown Date'}</span>
                      <span style={{color: 'var(--google-blue)'}}>{doc.text_blocks?.length || 0} blocks</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Work Area Panel */}
        <div className="main-area">
          {/* RAG Search Input */}
          <form className="search-container" onSubmit={handleSearch}>
            <div className="search-input-wrapper">
              <i className="fa-solid fa-magnifying-glass search-icon-inside"></i>
              <input 
                type="text" 
                className="search-input" 
                placeholder="Ask the RAG Assistant about your digitized documents (e.g. 'What is Gemma 4?')"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <button type="submit" className="search-button">
              <i className="fa-solid fa-robot"></i>
              Search RAG
            </button>
          </form>

          {/* Upload Simulation Status */}
          {uploading && (
            <div className="upload-processing">
              <div className="processing-header">
                <span>OCR Digitation Pipeline Simulator</span>
                <span style={{color: 'var(--google-blue)', fontWeight: 'bold'}}>{uploadProgress}%</span>
              </div>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{width: `${uploadProgress}%`}}></div>
              </div>
              <div className="processing-step">
                <div className="spinner"></div>
                <span>{uploadStep}</span>
              </div>
            </div>
          )}

          {/* RAG Search Processing Status */}
          {searchProgress > 0 && (
            <div className="upload-processing" style={{ borderColor: 'var(--google-green)', background: 'rgba(52, 168, 83, 0.06)' }}>
              <div className="processing-header">
                <span>Gemma 4 Semantic RAG Agent Processing</span>
                <span style={{color: 'var(--google-green)', fontWeight: 'bold'}}>{searchProgress}%</span>
              </div>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{width: `${searchProgress}%`, background: 'linear-gradient(90deg, #34a853, #4285f4)'}}></div>
              </div>
              <div className="processing-step">
                <div className="spinner" style={{ borderLeftColor: 'var(--google-green)' }}></div>
                <span>{searchStep}</span>
              </div>
            </div>
          )}

          {/* Interactive Workspace View */}
          <div className="viewer-grid">
            {/* Left Panel: Search Results or Text Content */}
            <div className="glass-panel answer-panel">
              {searchResult ? (
                <div>
                  <h3 className="panel-title" style={{borderColor: 'var(--google-blue)'}}>
                    <i className="fa-solid fa-comment-nodes" style={{color: 'var(--google-blue)'}}></i>
                    AI RAG Answer
                  </h3>
                  <div className="answer-card">
                    <div className="answer-text">
                      <p dangerouslySetInnerHTML={{__html: searchResult.answer.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}}></p>
                    </div>
                  </div>

                  <h4 style={{fontSize: '0.9rem', fontWeight: '600', marginTop: '1.5rem', color: '#fff'}}>
                    Document Citations & Source Blocks:
                  </h4>
                  <div className="citations-list">
                    {searchResult.citations && searchResult.citations.map((cit, idx) => (
                      <div 
                        key={idx} 
                        className="citation-item"
                        onClick={() => handleCitationClick(cit)}
                      >
                        <div className="citation-header">
                          <span className="citation-badge">Citation #{idx + 1}</span>
                          <span>{cit.fileName.split('/')[1] || cit.fileName}</span>
                        </div>
                        <p style={{fontSize: '0.8rem', color: '#fff'}}>{cit.reason}</p>
                        <div className="citation-snippet">
                          "{cit.snippet}"
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : selectedDoc ? (
                <div>
                  <div className="tab-headers">
                    <button 
                      className={`tab-btn ${activeTab === 'text' ? 'active' : ''}`}
                      onClick={() => setActiveTab('text')}
                    >
                      Extracted OCR Text
                    </button>
                    <button 
                      className={`tab-btn ${activeTab === 'metadata' ? 'active' : ''}`}
                      onClick={() => setActiveTab('metadata')}
                    >
                      Extracted Metadata
                    </button>
                  </div>

                  {activeTab === 'text' ? (
                    <div style={{fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.7', whiteSpace: 'pre-wrap'}}>
                      <h3 style={{color: '#fff', fontSize: '1.1rem', marginBottom: '10px'}}>{selectedDoc.title}</h3>
                      {selectedDoc.full_text}
                    </div>
                  ) : (
                    <div>
                      <h3 style={{color: '#fff', fontSize: '1.1rem', marginBottom: '15px'}}>File Metadata Properties</h3>
                      <table className="metadata-table">
                        <tbody>
                          <tr>
                            <td className="label">File GCS Path</td>
                            <td className="value">{selectedDoc.fileName}</td>
                          </tr>
                          <tr>
                            <td className="label">Creation Date</td>
                            <td className="value">{selectedDoc.metadata?.creation_date || 'Unknown'}</td>
                          </tr>
                          <tr>
                            <td className="label">Author</td>
                            <td className="value">{selectedDoc.metadata?.author || 'Unknown'}</td>
                          </tr>
                          {selectedDoc.metadata?.additional_metadata && 
                            Object.entries(selectedDoc.metadata.additional_metadata).map(([key, val], i) => (
                              <tr key={i}>
                                <td className="label" style={{textTransform: 'capitalize'}}>{key.replace(/_/g, ' ')}</td>
                                <td className="value">{val}</td>
                              </tr>
                            ))
                          }
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)'}}>
                  <i className="fa-solid fa-file-invoice" style={{fontSize: '3rem', marginBottom: '1rem', opacity: 0.3}}></i>
                  <p>Select a document or run a RAG search to begin.</p>
                </div>
              )}
            </div>

            {/* Right Panel: Bounding Box Image Overlay */}
            <div className="glass-panel" style={{display: 'flex', flexDirection: 'column'}}>
              <h3 className="panel-title" style={{borderColor: 'var(--google-red)'}}>
                <i className="fa-solid fa-eye" style={{color: 'var(--google-red)'}}></i>
                OCR Document Canvas Viewer
              </h3>
              
              {selectedDoc ? (
                <div style={{position: 'relative', flex: 1}}>
                  <div className="canvas-wrapper" style={{display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
                    <div 
                      className="image-overlay-container"
                      style={imageSize.width ? { width: `${imageSize.width}px`, height: `${imageSize.height}px` } : {}}
                    >
                      {/* The proxied image/SVG from GCS */}
                      <img 
                        ref={imgRef}
                        className="document-view-img"
                        src={selectedDoc.objectUrl || `/api/document-image?file=${encodeURIComponent(selectedDoc.fileName)}&title=${encodeURIComponent(selectedDoc.title || '')}`}
                        alt="Digitized Document Page"
                        onLoad={updateImageSize}
                      />

                      {/* Overlay absolute bounding box divs matching the model areas */}
                      {selectedDoc.text_blocks && selectedDoc.text_blocks.map((block, idx) => {
                        const area = block.area;
                        if (!area) return null;

                        // Express coordinate values as standard percentage values for exact scalability
                        const top = (area.ymin / 10).toFixed(2) + '%';
                        const left = (area.xmin / 10).toFixed(2) + '%';
                        const height = ((area.ymax - area.ymin) / 10).toFixed(2) + '%';
                        const width = ((area.xmax - area.xmin) / 10).toFixed(2) + '%';

                        const highlighted = isBlockHighlighted(block);

                        return (
                          <div 
                            key={idx}
                            className={`ocr-bounding-box ${highlighted ? 'highlighted' : ''}`}
                            style={{ top, left, height, width }}
                          >
                            <div className="ocr-tooltip">
                              <strong style={{color: 'var(--google-blue)'}}>Block #{idx+1}</strong>: {block.text.substring(0, 80)}...
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <p style={{fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'center'}}>
                    <i className="fa-solid fa-circle-info"></i> Bounding boxes extracted by Gemma 4 are drawn on top. 
                    <span style={{color: 'var(--google-red)', marginLeft: '10px'}}>Red blocks</span> indicate RAG citation matches.
                  </p>

                  <div className="json-viewer-container">
                    <div className="json-viewer-title">
                      <i className="fa-solid fa-code" style={{color: 'var(--google-green)'}}></i>
                      Digitized Document JSON (Gemma 4 Output)
                    </div>
                    <textarea 
                      className="json-textarea"
                      readOnly
                      value={JSON.stringify(selectedDoc, null, 2)}
                    />
                  </div>
                </div>
              ) : (
                <div style={{textAlign: 'center', padding: '5rem 0', color: 'var(--text-muted)'}}>
                  <p>No document selected</p>
                </div>
              )}
            </div>
          </div>

          {/* GDG / Event Info Section */}
          <div className="glass-panel demo-tips">
            <h4 style={{fontWeight: '600', color: 'var(--google-yellow)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px'}}>
              <i className="fa-solid fa-lightbulb"></i>
              GDG Lisbon - GenAI Community Pro-Tips
            </h4>
            <p>This event demo represents a modern multi-agent pipeline setup:</p>
            <ul>
              <li><strong>Cloud Storage</strong> triggers events to <strong>Pub/Sub</strong> instantly as document images land.</li>
              <li>A <strong>Pub/Sub Push Subscription</strong> ensures zero polling, hitting the <strong>Cloud Run</strong> container immediately.</li>
              <li><strong>Gemma-4</strong> uses multimodal vision reasoning to detect both coordinates (YMin, XMin, YMax, XMax) and metadata elements.</li>
              <li><strong>RAG with ADK</strong> empowers users to query the full digitized vault semantic-wise, tracing facts back to their physical visual boxes.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// Render React App
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
