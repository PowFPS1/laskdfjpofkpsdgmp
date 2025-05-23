export enum MessageSender {
  USER = 'user',
  AI = 'ai',
}

export interface Citation {
  uri: string;
  title: string;
}

export interface Message {
  id: string;
  text: string; // Main text content. For image, this could be the prompt or a success/failure message.
  sender: MessageSender;
  timestamp: Date;
  imageUrl?: string; // If this message is an image, this will be its URL
  imageAltText?: string; // Alt text for the image, could be the prompt
  citations?: Citation[]; // For search results
  isError?: boolean; // If true, display this message as an error styling
}

export interface ChatSession {
  id: string;
  name: string; // Generated or user-defined name
  messages: Message[];
  createdAt: Date;
  lastUpdatedAt: Date;
}

export type Theme = 'light' | 'dark' | 'system';