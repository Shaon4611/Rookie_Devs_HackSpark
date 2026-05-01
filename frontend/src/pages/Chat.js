import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';

const Chat = () => {
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    if (activeSession) {
      fetchMessages(activeSession.id);
    }
  }, [activeSession]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchSessions = async () => {
    try {
      const res = await api.get('/agent/sessions');
      setSessions(res.data);
      if (res.data.length > 0 && !activeSession) {
        setActiveSession(res.data[0]);
      }
    } catch (err) {
      setError('Failed to load chat sessions');
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (sessionId) => {
    try {
      const res = await api.get(`/agent/sessions/${sessionId}/history`);
      setMessages(res.data.history || []);
    } catch (err) {
      console.error('Failed to load messages', err);
    }
  };

  const createNewChat = async () => {
    try {
      setLoading(true);
      const res = await api.post('/agent/sessions', { title: 'New Conversation' });
      setSessions([res.data, ...sessions]);
      setActiveSession(res.data);
      setMessages([]);
    } catch (err) {
      setError('Failed to create new chat');
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeSession) return;

    const userMsg = newMessage;
    setNewMessage('');
    setMessages([...messages, { role: 'user', content: userMsg }]);
    setSending(true);

    try {
      const res = await api.post('/agent/chat', {
        session_id: activeSession.id,
        message: userMsg
      });
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.reply }]);
    } catch (err) {
      console.error('Failed to send message', err);
      // Revert or show error
    } finally {
      setSending(false);
    }
  };

  if (loading && sessions.length === 0) {
    return (
      <div className="loading-spinner">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <div className="chat-sidebar">
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
          <button className="btn" onClick={createNewChat} style={{ width: '100%' }}>
            + New Chat
          </button>
        </div>
        <div className="chat-sessions">
          {sessions.map(session => (
            <div 
              key={session.id} 
              className={`chat-session-item ${activeSession?.id === session.id ? 'active' : ''}`}
              onClick={() => setActiveSession(session)}
            >
              <div style={{ fontWeight: '500', color: 'var(--text-main)' }}>
                {session.title || `Chat ${session.id.substring(0, 8)}`}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                {new Date(session.created_at).toLocaleDateString()}
              </div>
            </div>
          ))}
          {sessions.length === 0 && (
            <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              No chat sessions yet.
            </div>
          )}
        </div>
      </div>

      <div className="chat-main">
        {activeSession ? (
          <>
            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)', fontWeight: '600' }}>
              {activeSession.title || 'Chat Session'}
            </div>
            <div className="chat-history">
              {messages.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '2rem' }}>
                  Start a conversation...
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div key={idx} className={`chat-message ${msg.role === 'user' ? 'user' : 'system'}`}>
                    {msg.content}
                  </div>
                ))
              )}
              {sending && (
                <div className="chat-message system" style={{ opacity: 0.7 }}>
                  <div className="spinner" style={{ width: '20px', height: '20px', borderWidth: '2px' }}></div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <form className="chat-input-area" onSubmit={sendMessage}>
              <input
                type="text"
                placeholder="Type your message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                disabled={sending}
              />
              <button type="submit" disabled={sending || !newMessage.trim()}>
                Send
              </button>
            </form>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
            Select a chat session or create a new one.
          </div>
        )}
      </div>
    </div>
  );
};

export default Chat;
