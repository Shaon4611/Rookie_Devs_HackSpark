import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';

// Generate a UUID v4 for new sessions
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(dateStr).toLocaleDateString();
}

const Chat = () => {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeName, setActiveName] = useState('New Chat');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchSessions = async () => {
    try {
      const res = await api.get('/chat/sessions');
      const sessionList = res.data.sessions || [];
      setSessions(sessionList);
      // Auto-select most recent session
      if (sessionList.length > 0 && !activeSessionId) {
        loadSession(sessionList[0].sessionId, sessionList[0].name);
      }
    } catch (err) {
      setError('Failed to load sessions');
    } finally {
      setLoadingSessions(false);
    }
  };

  const loadSession = async (sessionId, name) => {
    setActiveSessionId(sessionId);
    setActiveName(name || 'Chat');
    setMessages([]);
    try {
      const res = await api.get(`/chat/${sessionId}/history`);
      setMessages(res.data.messages || []);
      setActiveName(res.data.name || name || 'Chat');
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  };

  const createNewChat = () => {
    const newId = generateUUID();
    setActiveSessionId(newId);
    setActiveName('New Chat');
    setMessages([]);
    inputRef.current?.focus();
  };

  const deleteSession = async (e, sessionId) => {
    e.stopPropagation();
    try {
      await api.delete(`/chat/${sessionId}`);
      const updated = sessions.filter(s => s.sessionId !== sessionId);
      setSessions(updated);
      if (activeSessionId === sessionId) {
        if (updated.length > 0) {
          loadSession(updated[0].sessionId, updated[0].name);
        } else {
          setActiveSessionId(null);
          setMessages([]);
        }
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;

    const sessionId = activeSessionId || generateUUID();
    if (!activeSessionId) setActiveSessionId(sessionId);

    const userMsg = newMessage.trim();
    setNewMessage('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg, timestamp: new Date().toISOString() }]);
    setSending(true);

    try {
      const res = await api.post('/chat', { sessionId, message: userMsg });
      const reply = res.data.reply || 'No reply.';
      setMessages(prev => [...prev, { role: 'assistant', content: reply, timestamp: new Date().toISOString() }]);

      // Refresh sessions list to get updated name/time
      const sessRes = await api.get('/chat/sessions');
      const sessionList = sessRes.data.sessions || [];
      setSessions(sessionList);

      // Update displayed name if it changed (new session got a name)
      const current = sessionList.find(s => s.sessionId === sessionId);
      if (current && current.name && current.name !== 'New Chat') {
        setActiveName(current.name);
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Failed to get a reply. Please try again.',
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="chat-container">
      {/* Sidebar */}
      <div className="chat-sidebar">
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
          <button id="new-chat-btn" className="btn" onClick={createNewChat} style={{ width: '100%' }}>
            + New Chat
          </button>
        </div>
        <div className="chat-sessions">
          {loadingSessions ? (
            <div style={{ padding: '2rem 1rem', textAlign: 'center' }}>
              <div className="spinner" style={{ width: '24px', height: '24px', margin: '0 auto' }}></div>
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              No sessions yet. Start a new chat!
            </div>
          ) : (
            sessions.map(session => (
              <div
                key={session.sessionId}
                className={`chat-session-item ${activeSessionId === session.sessionId ? 'active' : ''}`}
                onClick={() => loadSession(session.sessionId, session.name)}
                style={{ position: 'relative', paddingRight: '2.5rem' }}
              >
                <div style={{ fontWeight: '500', color: 'var(--text-main)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {session.name || `Session ${session.sessionId.substring(0, 8)}`}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  {timeAgo(session.lastMessageAt)}
                </div>
                <button
                  onClick={(e) => deleteSession(e, session.sessionId)}
                  style={{
                    position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)',
                    background: 'transparent', border: 'none', color: 'var(--text-muted)',
                    cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0.25rem'
                  }}
                  title="Delete session"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="chat-main">
        {activeSessionId ? (
          <>
            <div style={{
              padding: '1rem 1.5rem',
              borderBottom: '1px solid var(--border)',
              fontWeight: '600',
              fontSize: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <span>💬</span> {activeName}
            </div>

            <div className="chat-history">
              {messages.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '3rem' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🤖</div>
                  <p>Ask me anything about RentPi — products, categories, availability, trends, and more.</p>
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`chat-message ${msg.role === 'user' ? 'user' : 'system'}`}
                    style={{ whiteSpace: 'pre-wrap' }}
                  >
                    {msg.content}
                  </div>
                ))
              )}
              {sending && (
                <div className="chat-message system" style={{ opacity: 0.7, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }}></div>
                  <span>Thinking...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form className="chat-input-area" onSubmit={sendMessage}>
              <input
                ref={inputRef}
                id="chat-message-input"
                type="text"
                placeholder="Ask about rentals, products, availability..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                disabled={sending}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) sendMessage(e); }}
              />
              <button id="send-message-btn" type="submit" disabled={sending || !newMessage.trim()}>
                Send
              </button>
            </form>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '3rem' }}>💬</div>
            <p>Select a session or click <strong>+ New Chat</strong> to begin.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Chat;
