-- SQL Schema for College Communication Portal

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users Table
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    roll_no TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    online BOOLEAN DEFAULT false,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Calls Table
CREATE TABLE IF NOT EXISTS public.calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_roll TEXT NOT NULL REFERENCES public.users(roll_no),
    to_roll TEXT NOT NULL REFERENCES public.users(roll_no),
    status TEXT CHECK (status IN ('calling', 'accepted', 'rejected', 'ended')) DEFAULT 'calling',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 4. Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;

-- 5. Set Replica Identity to FULL (CRITICAL for realtime data)
ALTER TABLE public.users REPLICA IDENTITY FULL;
ALTER TABLE public.calls REPLICA IDENTITY FULL;
