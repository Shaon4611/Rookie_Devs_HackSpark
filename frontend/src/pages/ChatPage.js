import React, { useState, useEffect, useRef } from "react";
import { chat as chatApi } from "../services/api";
import "./ChatPage.css";

export function ChatPage() {
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const createNewSession = () => {
    const newSessionId = `session_${Date.now()}`;
    setSessions([
      { id: newSessionId, name: `Chat ${new Date().toLocaleTimeString()}` },
      ...sessions
    ]);
    setActiveSession(newSessionId);
    setMessages([]);
    setError("");
  };

  const handleSelectSession = (sessionId) => {
    setActiveSession(sessionId);
    const session = sessions.find((s) => s.id === sessionId);
    if (session && session.messages) {
      setMessages(session.messages);
    } else {
      setMessages([]);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();

    if (!inputMessage.trim() || !activeSession) {
      return;
    }

    const userMessage = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: inputMessage,
      timestamp: new Date().toISOString()
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    setLoading(true);
    setError("");

    try {
      const response = await chatApi.sendMessage(activeSession, inputMessage);

      if (response.status === 200 && response.data.reply) {
        const assistantMessage = {
          id: `msg_${Date.now() + 1}`,
          role: "assistant",
          content: response.data.reply,
          timestamp: new Date().toISOString()
        };
        setMessages((prev) => [...prev, assistantMessage]);

        setSessions((prevSessions) =>
          prevSessions.map((s) =>
            s.id === activeSession
              ? { ...s, messages: [...(s.messages || []), userMessage, assistantMessage] }
              : s
          )
        );
      } else {
        setError(response.data.message || "Failed to send message");
        setMessages((prev) => prev.slice(0, -1));
      }
    } catch (err) {
      setError(err.message || "Error sending message");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <div className="chat-page">
        <div className="chat-sidebar">
          <button onClick={createNewSession} className="new-chat-btn">
            + New Chat
          </button>

          <div className="sessions-list">
            {sessions.length === 0 ? (
              <div className="no-sessions">No chat sessions yet</div>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => handleSelectSession(session.id)}
                  className={`session-item ${activeSession === session.id ? "active" : ""}`}
                >
                  {session.name}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="chat-main">
          {!activeSession ? (
            <div className="no-chat-selected">
              <h2>Select or create a chat to get started</h2>
              <button onClick={createNewSession} className="start-chat-btn">
                Start New Chat
              </button>
            </div>
          ) : (
            <>
              <div className="chat-messages">
                {messages.length === 0 && (
                  <div className="empty-messages">
                    Start a conversation with the RentPi Assistant
                  </div>
                )}
                {messages.map((msg) => (
                  <div key={msg.id} className={`message ${msg.role}`}>
                    <div className="message-content">{msg.content}</div>
                    <div className="message-time">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="message assistant">
                    <div className="message-content">Thinking...</div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {error && <div className="chat-error">{error}</div>}

              <form onSubmit={handleSendMessage} className="chat-form">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="Type your message..."
                  disabled={loading}
                  className="chat-input"
                />
                <button type="submit" disabled={loading || !inputMessage.trim()} className="send-btn">
                  {loading ? "..." : "Send"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
