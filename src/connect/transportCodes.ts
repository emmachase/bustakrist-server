export enum RequestCode {
    PING = "PING",
    LOGIN = "LOGIN",
    LOGOUT = "LOGOUT",
    REGISTER = "REGISTER",
    REAUTH = "REAUTH",
    GETBAL = "GETBAL",
    SENDMSG = "SENDMSG",
    COMMIT_WAGER = "COMMIT_WAGER",
    PULLOUT_WAGER = "PULLOUT_WAGER",
    PROFILE = "PROFILE",
    PROFILE_BETS = "PROFILE_BETS",
    UPDATE_FRIEND = "UPDATE_FRIEND",
    TIP = "TIP",
    WITHDRAW = "WITHDRAW",
}

export enum UpdateCode {
    HELLO = "HELLO",
    REPLY = "REPLY",
    MESSAGE = "MESSAGE",
    MESSAGE_HISTORY = "MESSAGE_HISTORY",
    GAME_STARTING = "GAME_STARTING",
    BUSTED = "BUSTED",
    UPDATE_PLAYING = "UPDATE_PLAYING",
    ADD_PLAYER = "ADD_PLAYER",
    ADD_ALL_PLAYERS = "ADD_ALL_PLAYERS",
    PLAYER_CASHEDOUT = "PLAYER_CASHEDOUT",
    UPDATE_BALANCE = "UPDATE_BALANCE",
    RECIEVE_TIP = "RECIEVE_TIP",
    HISTORY = "HISTORY",
    ALERT_SAFETY = "ALERT_SAFETY",
    PAUSED = "PAUSED",
    FORCERELOAD = "FORCERELOAD",
}

export enum ErrorCode {
    BANNED = "BANNED",
    MALFORMED = "MALFORMED",
    UNKNOWN_TYPE = "UNKNOWN_TYPE",
    INVALID_DATA = "INVALID_DATA",
    UNAUTHORIZED = "UNAUTHORIZED",
    UNFULFILLABLE = "UNFULFILLABLE",
    INTERNAL_ERROR = "INTERNAL_ERROR",
}

export enum ErrorDetail {
    INVALID_JSON = "INVALID_JSON",
    TOO_BIG = "TOO_BIG",
    NO_TYPE = "NO_TYPE",
    USERNAME_TAKEN = "USERNAME_TAKEN",
    NOT_LOGGED_IN = "NOT_LOGGED_IN",
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
    LOW_BALANCE = "LOW_BALANCE",
    NOT_PLAYING = "NOT_PLAYING",
    ALREADY_PLAYING = "ALREADY_PLAYING",
    NOT_EXISTS = "NOT_EXISTS",
    NOOP = "NOOP",
}
