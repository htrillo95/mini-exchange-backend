import { Router } from "express";
import { processOrder, trades, orderBook} from "../services/matchingEngine";
const router = Router(); //mini server, (anything that starts with /api/orders, go ask this router what to do)

type Order = {
    id: string
    type: "buy" | "sell";
    price: number;
    quantity: number;
};

router.post("/", (req,res) => {
    const {type, price, quantity} = req.body;

    //basic validation
    if (!type || !price || !quantity) {
        return res.status(400).json({error:"Missing fields"});
    }

    //create order - new order object
    const order: Order = {
        id: Math.random().toString(36).substring(2,9),
        type,
        price,
        quantity,
    };

    const result = processOrder(order);

    return res.json({ success: true, order, ...result });  
});

    router.get("/", (_req, res) => {
        res.json({message: "Orders API endpoint is working"});
    });

    router.get("/trades", (_req,res) => {
        res.json(trades);
    });

    router.get("/book", (_req, res) => {
        res.json(orderBook);
    });


    //CANCEL ORDER by ID
    router.delete("/:id", (req, res) => {
        const {id} = req.params;

        const buyIndex = orderBook.buy.findIndex((o) => o.id === id);
        const sellIndex = orderBook.sell.findIndex((o) => o.id === id);

        if (buyIndex === -1 && sellIndex === -1) {
            return res.status(404).json({ success: false, message: "Order not found in book"});
        }

        if (buyIndex !== -1) {
            orderBook.buy.splice(buyIndex, 1);
            console.log(` Canceled BUY order ${id}`);
        } else {
            orderBook.sell.splice(sellIndex, 1);
            console.log(` Canceled SELL order ${id}`);
        }

        return res.json({ succes: true, message: "Order canceled", id});
    });

export default router;