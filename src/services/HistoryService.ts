import { Subscription } from "rxjs";
import { ChatService } from "./ChatService";
import { GameService } from "./GameService";

export class HistoryService {
    private static _instance: HistoryService;
    public static get instance() {
        if (this._instance) return this._instance;
        else return this._instance = new HistoryService();
    }

    private gameSubscription: Subscription;
    private chatSubscription: Subscription;

    public subscribe() {
        this.gameSubscription = GameService.instance.GameStream.subscribe(ev => {

        });

        this.chatSubscription = ChatService.instance.subscribe(ev => {
            if (!ev.private) {
                
            }
        });
    }
}