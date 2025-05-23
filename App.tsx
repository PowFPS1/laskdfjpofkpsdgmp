
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Message, MessageSender, ChatSession, Theme } from './types';
import ChatBubble from './components/ChatBubble';
import ChatInput from './components/ChatInput';
import Sidebar from './components/Sidebar';
import ThemeToggle from './components/ThemeToggle';
import { initChatSession, sendMessageToAI, generateChatNameWithAI, generateImageFromPrompt } from './services/geminiService';
import { 
  INITIAL_AI_MESSAGE, 
  INITIAL_CHAT_NAME_PLACEHOLDER,
  LOCAL_STORAGE_CHAT_SESSIONS_KEY,
  LOCAL_STORAGE_THEME_KEY,
  MIN_MESSAGES_FOR_NAME_GENERATION,
  MAX_SNIPPET_LENGTH_FOR_NAME_GENERATION,
} from './constants';
import { Chat, Content } from '@google/genai';
import { MenuIcon, BotIcon } from './components/IconComponents';

const App: React.FC = () => {
  const [allChatSessions, setAllChatSessions] = useState<Record<string, ChatSession>>({});
  const [currentChatSessionId, setCurrentChatSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingName, setIsLoadingName] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(window.innerWidth > 1024); // Adjusted breakpoint for sidebar
  
  const [theme, setTheme] = useState<Theme>(() => {
    const storedTheme = localStorage.getItem(LOCAL_STORAGE_THEME_KEY) as Theme | null;
    // Default to dark theme as per "black-and-white" primary request
    return storedTheme || 'dark'; 
  });
  
  const chatSessionRef = useRef<Chat | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const apiKeyErrorDisplayedRef = useRef(false);

  useEffect(() => {
    const root = window.document.documentElement;
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    // Apply dark theme if 'dark' is selected, or if 'system' is selected and system prefers dark
    if (theme === 'dark' || (theme === 'system' && systemPrefersDark)) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem(LOCAL_STORAGE_THEME_KEY, theme);
  }, [theme]);

  const debounce = <F extends (...args: any[]) => any>(func: F, waitFor: number) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<F>): Promise<ReturnType<F>> =>
      new Promise(resolve => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => resolve(func(...args)), waitFor);
      });
  };
  
  const saveChatSessionsToLocalStorage = useCallback(debounce((sessions: Record<string, ChatSession>) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_CHAT_SESSIONS_KEY, JSON.stringify(sessions));
    } catch (error) {
      console.error("Error saving chat sessions to localStorage:", error);
    }
  }, 500), []);

  const addMessageToCurrentChat = useCallback((message: Message) => {
    if (!currentChatSessionId) return;
    setAllChatSessions(prev => {
      const currentSession = prev[currentChatSessionId];
      if (!currentSession) return prev;
      return {
        ...prev,
        [currentChatSessionId]: {
          ...currentSession,
          messages: [...currentSession.messages, message],
          lastUpdatedAt: new Date(),
        }
      };
    });
  }, [currentChatSessionId]);
  
  const initializeNewChatObject = useCallback((sessionId: string | null) => {
    if (!sessionId || !allChatSessions[sessionId]) {
      chatSessionRef.current = null;
      return;
    }

    const currentSession = allChatSessions[sessionId];
    const historyForGemini: Content[] = currentSession.messages
      .filter(msg => !msg.isError && msg.sender !== MessageSender.AI || (msg.sender === MessageSender.AI && msg.text !== INITIAL_AI_MESSAGE))
      .map(msg => ({
        role: msg.sender === MessageSender.USER ? 'user' : 'model',
        parts: [{ text: msg.text }] 
    }));
    
    try {
        if (!process.env.API_KEY) {
            if (!apiKeyErrorDisplayedRef.current) {
                console.error("API_KEY is not set. Cannot initialize chat object.");
                const errorMsg = 'Configuration Error: API Key not found. Please ensure API_KEY is set in your environment. The application cannot connect to the AI service.';
                addMessageToCurrentChat({
                    id: `error-no-key-init-${Date.now()}`, text: errorMsg,
                    sender: MessageSender.AI, timestamp: new Date(), isError: true,
                });
                apiKeyErrorDisplayedRef.current = true;
            }
            chatSessionRef.current = null;
            return;
        }
        apiKeyErrorDisplayedRef.current = false;
        chatSessionRef.current = initChatSession(historyForGemini);
    } catch (error) {
        console.error("Failed to initialize chat object:", error);
        const errorText = error instanceof Error ? error.message : "Unknown error initializing chat.";
         addMessageToCurrentChat({
            id: `error-init-obj-${Date.now()}`, text: `Error initializing chat: ${errorText}`,
            sender: MessageSender.AI, timestamp: new Date(), isError: true,
        });
        chatSessionRef.current = null;
    }
  }, [allChatSessions, addMessageToCurrentChat]);


  useEffect(() => {
    let loadedSessions: Record<string, ChatSession> = {};
    try {
      const storedSessions = localStorage.getItem(LOCAL_STORAGE_CHAT_SESSIONS_KEY);
      if (storedSessions) {
        const parsedSessions = JSON.parse(storedSessions);
        Object.values(parsedSessions).forEach((session: any) => {
          session.createdAt = new Date(session.createdAt);
          session.lastUpdatedAt = new Date(session.lastUpdatedAt);
          session.messages.forEach((msg: any) => msg.timestamp = new Date(msg.timestamp));
        });
        loadedSessions = parsedSessions;
      }
    } catch (error) { console.error("Error loading chat sessions:", error); }
    
    if (Object.keys(loadedSessions).length === 0) {
      const newId = `chat-${Date.now()}`;
      const newSession: ChatSession = {
        id: newId, name: INITIAL_CHAT_NAME_PLACEHOLDER,
        messages: [{
          id: `ai-welcome-${Date.now()}`, text: INITIAL_AI_MESSAGE,
          sender: MessageSender.AI, timestamp: new Date()
        }],
        createdAt: new Date(), lastUpdatedAt: new Date(),
      };
      loadedSessions[newId] = newSession;
      setCurrentChatSessionId(newId);
    } else {
      const sortedSessions = Object.values(loadedSessions).sort((a, b) => b.lastUpdatedAt.getTime() - a.lastUpdatedAt.getTime());
      setCurrentChatSessionId(sortedSessions[0].id);
    }
    setAllChatSessions(loadedSessions);
  }, []);

  useEffect(() => {
    if (currentChatSessionId) {
      initializeNewChatObject(currentChatSessionId);
    }
  }, [currentChatSessionId, initializeNewChatObject]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [allChatSessions, currentChatSessionId]);

  useEffect(() => {
    if (Object.keys(allChatSessions).length > 0) {
      saveChatSessionsToLocalStorage(allChatSessions);
    }
  }, [allChatSessions, saveChatSessionsToLocalStorage]);

  const handleNewChat = () => {
    const newId = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const newSession: ChatSession = {
      id: newId, name: INITIAL_CHAT_NAME_PLACEHOLDER,
      messages: [{
        id: `ai-welcome-${newId}`, text: INITIAL_AI_MESSAGE,
        sender: MessageSender.AI, timestamp: new Date()
      }],
      createdAt: new Date(), lastUpdatedAt: new Date(),
    };
    setAllChatSessions(prev => ({ ...prev, [newId]: newSession }));
    setCurrentChatSessionId(newId);
    if (window.innerWidth < 1024) setIsSidebarOpen(false); // Adjusted breakpoint
  };

  const handleSelectChat = (sessionId: string) => {
    setCurrentChatSessionId(sessionId);
    if (window.innerWidth < 1024) setIsSidebarOpen(false); // Adjusted breakpoint
  };

  const handleDeleteChat = (sessionId: string) => {
    if (!confirm(`Are you sure you want to delete "${allChatSessions[sessionId]?.name || 'this chat'}"? This action cannot be undone.`)) return;
    
    const updatedSessions = { ...allChatSessions };
    delete updatedSessions[sessionId];
    setAllChatSessions(updatedSessions);

    if (currentChatSessionId === sessionId) {
      const remainingSessions = Object.values(updatedSessions).sort((a,b) => b.lastUpdatedAt.getTime() - a.lastUpdatedAt.getTime());
      if (remainingSessions.length > 0) {
        setCurrentChatSessionId(remainingSessions[0].id);
      } else {
        handleNewChat(); 
      }
    }
  };
  
  const generateAndSetChatName = useCallback(async (sessionId: string) => {
    const session = allChatSessions[sessionId];
    if (!session || session.name !== INITIAL_CHAT_NAME_PLACEHOLDER || session.messages.length < MIN_MESSAGES_FOR_NAME_GENERATION || isLoadingName) return;
    
    setIsLoadingName(true);
    const conversationSnippet = session.messages
      .filter(m => !m.imageUrl) 
      .slice(0, MIN_MESSAGES_FOR_NAME_GENERATION + 1) 
      .map(m => `${m.sender === MessageSender.USER ? 'User' : 'Aura'}: ${m.text}`)
      .join('\n')
      .substring(0, MAX_SNIPPET_LENGTH_FOR_NAME_GENERATION);

    try {
      const generatedName = await generateChatNameWithAI(conversationSnippet);
      setAllChatSessions(prev => {
        if (prev[sessionId] && prev[sessionId].name === INITIAL_CHAT_NAME_PLACEHOLDER) {
          return { ...prev, [sessionId]: { ...prev[sessionId], name: generatedName || "Chat Summary" } };
        }
        return prev;
      });
    } catch (error) { console.error("Failed to generate chat name:", error); } 
    finally { setIsLoadingName(false); }
  }, [allChatSessions, isLoadingName]);


  const handleSendMessage = async (text: string) => {
    if (!currentChatSessionId) return;

    const newUserMessage: Message = {
      id: `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      text, sender: MessageSender.USER, timestamp: new Date(),
    };
    addMessageToCurrentChat(newUserMessage);
    setIsLoading(true);

    if (text.toLowerCase().startsWith("/image ") || text.toLowerCase() === "/image") {
      const prompt = text.substring(text.indexOf(" ") + 1).trim();
      if (!prompt && text.toLowerCase() === "/image") {
         addMessageToCurrentChat({
          id: `ai-error-${Date.now()}`, text: "Please provide a prompt for the image after '/image '.",
          sender: MessageSender.AI, timestamp: new Date(), isError: true,
        });
        setIsLoading(false);
        return;
      }
      
      addMessageToCurrentChat({ 
          id: `ai-generating-${Date.now()}`, text: `Generating image for: "${prompt}"...`,
          sender: MessageSender.AI, timestamp: new Date(),
      });

      const result = await generateImageFromPrompt(prompt);
      if (result.imageUrl) {
        addMessageToCurrentChat({
          id: `ai-img-${Date.now()}`, text: `Image generated for: "${prompt}"`, imageUrl: result.imageUrl, imageAltText: result.altText || prompt,
          sender: MessageSender.AI, timestamp: new Date(),
        });
      } else {
        addMessageToCurrentChat({
          id: `ai-img-error-${Date.now()}`, text: result.error || "Failed to generate image.",
          sender: MessageSender.AI, timestamp: new Date(), isError: true,
        });
      }
      setIsLoading(false);
      return;
    }

    if (!chatSessionRef.current) {
      initializeNewChatObject(currentChatSessionId); 
      if (!chatSessionRef.current) {
          const errorText = apiKeyErrorDisplayedRef.current ? 
              "API Key not configured. Please ensure it is set in your environment and refresh." :
              "Chat session is not initialized. Please try again or refresh.";
          addMessageToCurrentChat({
            id: `ai-error-no-session-${Date.now()}`, text: errorText,
            sender: MessageSender.AI, timestamp: new Date(), isError: true,
          });
          setIsLoading(false);
          return;
      }
    }
    
    try {
      const { text: aiResponseText, citations } = await sendMessageToAI(chatSessionRef.current, text);
      const newAiMessage: Message = {
        id: `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        text: aiResponseText, sender: MessageSender.AI, timestamp: new Date(),
        citations: citations,
        isError: aiResponseText.toLowerCase().includes("error:") || aiResponseText.toLowerCase().includes("sorry, i encountered an error"),
      };
      addMessageToCurrentChat(newAiMessage);
      
      if (allChatSessions[currentChatSessionId]?.name === INITIAL_CHAT_NAME_PLACEHOLDER && 
          allChatSessions[currentChatSessionId]?.messages.filter(m => !m.imageUrl).length >= MIN_MESSAGES_FOR_NAME_GENERATION) {
        generateAndSetChatName(currentChatSessionId);
      }

    } catch (error) { 
      console.error("Error getting AI response in App:", error);
      const errorText = error instanceof Error ? error.message : "An unknown error occurred.";
      addMessageToCurrentChat({
        id: `ai-error-response-${Date.now()}`, text: `Sorry, I had trouble responding: ${errorText}`,
        sender: MessageSender.AI, timestamp: new Date(), isError: true,
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const currentMessages = currentChatSessionId ? allChatSessions[currentChatSessionId]?.messages || [] : [];
  const lastMeaningfulMessage = [...currentMessages].reverse().find(msg => !(msg.sender === MessageSender.AI && msg.text.startsWith("Generating image for:")));
  const isLastMessageUser = lastMeaningfulMessage?.sender === MessageSender.USER;


  return (
    <div className="flex h-screen overflow-hidden bg-lm_bg dark:bg-dm_bg text-lm_text_primary dark:text-dm_text_primary">
      <Sidebar 
        sessions={Object.values(allChatSessions).sort((a,b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime())}
        currentSessionId={currentChatSessionId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onDeleteChat={handleDeleteChat}
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        isLoadingName={isLoadingName}
      />

      <div className="flex flex-col flex-grow h-full transition-all duration-300">
        <header className="bg-lm_panel dark:bg-dm_panel_deep text-lm_text_primary dark:text-dm_text_primary p-3 sm:p-4 flex items-center justify-between z-10 border-b border-lm_border dark:border-dm_border shadow-neumorphic-lm-sm dark:shadow-neumorphic-dm-sm">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
              className="p-2 rounded-md hover:bg-lm_panel_deep dark:hover:bg-dm_panel lg:hidden text-lm_text_secondary dark:text-dm_text_secondary"
              aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
              <MenuIcon className="w-6 h-6" />
            </button>
            <BotIcon className="w-8 h-8 text-lm_accent dark:text-dm_accent flex-shrink-0" />
            <h1 className="text-xl md:text-2xl font-semibold truncate">
              {currentChatSessionId && allChatSessions[currentChatSessionId] ? allChatSessions[currentChatSessionId].name : "Aura AI"}
            </h1>
          </div>
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </header>

        <main 
          ref={chatContainerRef} 
          className="flex-grow overflow-y-auto p-3 md:p-6 space-y-3 bg-lm_bg dark:bg-dm_bg" // Removed specific panel color to allow bubbles to pop
          aria-live="polite"
          role="log"
        >
          {currentMessages.map(msg => (
            <ChatBubble key={msg.id} message={msg} />
          ))}
          {isLoading && isLastMessageUser && !currentMessages.some(m => m.text.startsWith("Generating image for:")) && (
             <div className="flex items-end gap-2.5 justify-start">
               <div className="flex-shrink-0 self-start mt-1">
                  <BotIcon className="w-7 h-7 text-lm_accent dark:text-dm_accent" />
               </div>
               <div className="max-w-[70%] p-3 rounded-2xl bg-lm_panel dark:bg-dm_panel shadow-neumorphic-lm-sm dark:shadow-neumorphic-dm-sm text-lm_text_secondary dark:text-dm_text_secondary rounded-bl-lg">
                  <div className="flex space-x-1.5 items-center">
                      <span className="text-sm">Aura is typing</span>
                      <div className="w-1.5 h-1.5 bg-dm_text_secondary/70 dark:bg-lm_text_secondary/70 rounded-full animate-pulse delay-75"></div>
                      <div className="w-1.5 h-1.5 bg-dm_text_secondary/70 dark:bg-lm_text_secondary/70 rounded-full animate-pulse delay-150"></div>
                      <div className="w-1.5 h-1.5 bg-dm_text_secondary/70 dark:bg-lm_text_secondary/70 rounded-full animate-pulse delay-200"></div>
                  </div>
               </div>
             </div>
          )}
        </main>

        <footer className="bg-lm_panel dark:bg-dm_panel_deep border-t border-lm_border dark:border-dm_border shadow-[0_-2px_5px_rgba(0,0,0,0.03)] dark:shadow-[0_-2px_5px_rgba(0,0,0,0.2)]">
          <ChatInput onSendMessage={handleSendMessage} isLoading={isLoading} />
        </footer>
      </div>
    </div>
  );
};

export default App;
