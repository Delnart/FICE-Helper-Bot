export interface TelegramInitData {
    query_id?: string;
    user?: {
        id: number;
        is_bot?: boolean;
        first_name: string;
        last_name?: string;
        username?: string;
        language_code?: string;
        photo_url?: string;
    };
    auth_date: number;
    hash: string;
    chat_instance?: string;
    chat_type?: string;
    start_param?: string;
}
