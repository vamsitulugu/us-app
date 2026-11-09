// Canteen MENU DATA. Prices are Twin Hearts GOLD COINS (no money). The server (us-app/lib/canteen-menu.json) holds the same menu and
// re-prices every order itself, so regenerate it after editing this file:  npm run export-menu

/* ------------------------------ menu data ------------------------------ */
// group: {id,name,multi,req,opts:[{n,p}]}  p = price added when picked.  item.vis = what you hold: popcorn | drink | ice | food
const G=(name,opts,{multi=0,req=0}={})=>({name,multi,req,opts:opts.map(o=>typeof o==='string'?{n:o,p:0}:{n:o[0],p:o[1]})});
const SIZE=(a=0,b=40,c=80)=>G('Size',[['Small',a],['Medium',b],['Large',c]],{req:1});
const ICE=G('Ice',['Regular ice','Less ice','No ice','Extra ice'],{req:1});
const SUGAR=G('Sugar',['Normal','Less sugar','No sugar','Extra sweet'],{req:1});
const DRINKS=['Cola','Lime Soda','Orange Fizz','Iced Tea','Cold Coffee','Mango Shake','Chocolate Shake','Strawberry Shake','Fresh Lime Juice','Mineral Water'];
const FLAV=G('Flavour',[['Salted',0],['Butter',0],['Caramel',10],['Cheese',10],['Peri-Peri',10],['Chocolate Drizzle',20]],{req:1});
const ICEFLAV=['Vanilla','Chocolate','Strawberry','Butterscotch','Mango','Choco Chip','Pistachio','Black Currant'];
const DIPS=G('Dips',[['Ketchup',0],['Mayo',0],['Cheese dip',15],['Garlic dip',10],['Salsa',10]],{multi:1});

export const CATS=[{id:'popcorn',name:'Popcorn',e:'🍿'},{id:'combo',name:'Couple Combos',e:'💑'},{id:'drinks',name:'Cold Drinks',e:'🥤'},{id:'hot',name:'Coffee & Tea',e:'☕'},{id:'ice',name:'Ice Cream',e:'🍦'},{id:'snacks',name:'Snacks & Meals',e:'🌭'},{id:'sweet',name:'Desserts & Sweets',e:'🍩'}];

const I=(cat,e,name,price,desc,groups=[],o={})=>({id:cat+':'+name,cat,e,name,price,desc,groups,vis:cat==='popcorn'?'popcorn':cat==='drinks'||cat==='hot'?'drink':cat==='ice'?'ice':'food',...o});
const RAW=[
 I('popcorn','🍿','Popcorn',99,'Fresh popped, any flavour, any size',[FLAV,G('Size',[['Small',0],['Medium',50],['Large',100],['Sharing Tub',170]],{req:1}),G('Extras',[['Extra butter',20],['Extra cheese',25],['Caramel drizzle',25],['Mix two flavours',30]],{multi:1})],{veg:1}),
 I('popcorn','💗','Love Bucket (heart, reusable)',299,'Keepsake heart bucket with a refill of your flavour',[FLAV],{veg:1}),
 I('popcorn','🧀','Cheese Popcorn Boat',169,'Loaded with cheese powder and jalapeno',[G('Spice',['Mild','Medium','Hot'],{req:1}),G('Size',[['Regular',0],['Large',60]],{req:1})],{veg:1}),

 I('combo','💑','Couple Combo',399,'1 Large popcorn + 2 Medium drinks',[FLAV,G('Drink 1',DRINKS,{req:1}),G('Drink 2',DRINKS,{req:1}),ICE],{vis:'popcorn',veg:1,vis2:['popcorn','drink','drink']}),
 I('combo','🌙','Date Night Combo',599,'Large popcorn + 2 drinks + nachos + brownie',[FLAV,G('Drink 1',DRINKS,{req:1}),G('Drink 2',DRINKS,{req:1}),G('Nacho dip',['Cheese','Salsa','Jalapeno'],{req:1})],{vis2:['popcorn','drink','drink','food','food'],veg:1}),
 I('combo','💞','Sweetheart Combo',449,'Heart sundae for two + Medium popcorn + 2 drinks',[G('Sundae flavour',ICEFLAV,{req:1}),FLAV,G('Drink 1',DRINKS,{req:1}),G('Drink 2',DRINKS,{req:1})],{vis2:['ice','popcorn','drink','drink'],veg:1}),
 I('combo','🍔','Snack Feast Combo',649,'2 burgers + fries + 2 Medium drinks',[G('Burger',['Veg','Paneer','Chicken'],{req:1}),G('Fries',['Salted','Peri-Peri','Cheesy'],{req:1}),G('Drink 1',DRINKS,{req:1}),G('Drink 2',DRINKS,{req:1})],{vis2:['food','food','food','drink','drink']}),

 ...['Cola','Lime Soda','Orange Fizz','Iced Tea'].map(n=>I('drinks','🥤',n,59,'Ice cold, freshly poured',[SIZE(0,20,40),ICE,G('Extras',[['Lemon wedge',5],['Mint',5],['Ice cream scoop (float)',35]],{multi:1})],{veg:1})),
 ...['Cold Coffee','Mango Shake','Chocolate Shake','Strawberry Shake'].map(n=>I('drinks','🥛',n,119,'Thick and creamy',[SIZE(0,30,60),SUGAR,G('Extras',[['Whipped cream',20],['Ice cream scoop',35],['Choco syrup',15],['Extra shot',30]],{multi:1})],{veg:1})),
 I('drinks','🍋','Fresh Lime Juice',69,'Sweet, salted or mixed',[G('Style',['Sweet','Salted','Sweet & salted'],{req:1}),ICE],{veg:1}),
 I('drinks','💧','Mineral Water',30,'500 ml bottle',[G('Type',['Chilled','Room temperature'],{req:1})],{veg:1}),

 ...['Filter Coffee','Cappuccino','Latte','Hot Chocolate'].map(n=>I('hot','☕',n,89,'Served hot',[G('Size',[['Regular',0],['Large',30]],{req:1}),SUGAR,G('Milk',[['Regular',0],['Skimmed',0],['Soy',20],['Oat',30]],{req:1}),G('Extras',[['Extra shot',30],['Whipped cream',20],['Cinnamon',0],['Chocolate sprinkle',10]],{multi:1})],{veg:1})),
 ...['Masala Chai','Ginger Tea','Green Tea'].map(n=>I('hot','🍵',n,49,'Served hot',[G('Size',[['Regular',0],['Large',20]],{req:1}),SUGAR,G('Extras',[['Extra ginger',0],['Cardamom',5],['Lemon',5]],{multi:1})],{veg:1})),

 I('ice','🍦','Ice Cream',89,'Build your own: flavour, serve, scoops, toppings',[G('Flavour',ICEFLAV,{req:1}),G('Serve',[['Cup',0],['Cone',10],['Waffle cone',30]],{req:1}),G('Scoops',[['1 scoop',0],['2 scoops',40],['3 scoops',80]],{req:1}),G('Toppings',[['Choco syrup',15],['Sprinkles',10],['Nuts',20],['Caramel',15],['Cherry',10],['Brownie bits',25],['Whipped cream',15]],{multi:1})],{veg:1}),
 I('ice','💗','Couple Heart Sundae (for two)',349,'Heart-shaped bowl, two spoons, loads of toppings',[G('Flavour',ICEFLAV,{req:1}),G('Sauce',['Chocolate','Strawberry','Caramel','Butterscotch'],{req:1}),G('Extras',[['Brownie bits',25],['Nuts',20],['Cherry on top',10]],{multi:1})],{veg:1}),
 I('ice','🍨','Brownie Sundae',189,'Warm brownie, ice cream, hot fudge',[G('Flavour',ICEFLAV,{req:1}),G('Extras',[['Extra scoop',40],['Nuts',20]],{multi:1})],{veg:1}),
 I('ice','🥭','Kulfi',79,'Traditional stick kulfi',[G('Flavour',['Malai','Pista','Mango','Rabri'],{req:1})],{veg:1}),
 I('ice','🍫','Choco Bar',49,'Chocolate-coated ice cream bar',[G('Type',['Vanilla centre','Strawberry centre','Almond'],{req:1})],{veg:1}),

 I('snacks','🌮','Nachos',129,'Crispy chips with your dip',[G('Dip',[['Cheese',0],['Salsa',0],['Jalapeno cheese',15]],{req:1}),G('Size',[['Regular',0],['Large',60]],{req:1}),G('Extras',[['Extra cheese',25],['Jalapeno',10],['Beans',20],['Onion & corn',15]],{multi:1})],{veg:1}),
 I('snacks','🍟','French Fries',99,'Hot and crispy',[G('Seasoning',['Salted','Peri-Peri','Cheesy','Masala'],{req:1}),G('Size',[['Regular',0],['Large',50]],{req:1}),DIPS],{veg:1}),
 I('snacks','🥟','Samosa (2 pcs)',49,'Crispy potato samosas',[G('Chutney',['Green','Tamarind','Both'],{req:1})],{veg:1}),
 I('snacks','🥐','Veg Puff',39,'Flaky baked puff',[G('Serve',['Cold','Warmed'],{req:1})],{veg:1}),
 I('snacks','🌭','Hot Dog',119,'Toasted bun, grilled sausage',[G('Type',[['Veg',0],['Chicken',30]],{req:1}),G('Sauce',[['Mustard',0],['Ketchup',0],['Cheese',15],['Spicy mayo',10]],{multi:1})]),
 I('snacks','🍔','Burger',149,'Toasted bun, fresh patty',[G('Patty',[['Veg',0],['Paneer',20],['Chicken',30]],{req:1}),G('Extras',[['Cheese slice',20],['Extra patty',50],['Jalapeno',10],['Fried egg',20]],{multi:1})]),
 I('snacks','🍕','Pizza Slice',129,'Fresh from the oven',[G('Topping',[['Margherita',0],['Farmhouse',20],['Paneer Tikka',30],['Pepperoni',40]],{req:1}),G('Extras',[['Extra cheese',25],['Oregano & chilli flakes',0]],{multi:1})]),
 I('snacks','🥪','Grilled Sandwich',109,'Toasted with cheese',[G('Filling',[['Veg',0],['Cheese corn',20],['Chicken',40]],{req:1}),DIPS]),
 I('snacks','🍗','Chicken Nuggets',159,'Crunchy golden nuggets',[G('Pieces',[['6 pcs',0],['9 pcs',50]],{req:1}),G('Sauce',['Ketchup','Mayo','Peri-Peri','BBQ'],{multi:1})],{veg:0}),
 I('snacks','🥨','Soft Pretzel',89,'Warm and chewy',[G('Style',['Salted','Cinnamon sugar','Cheese stuffed'],{req:1})],{veg:1}),
 I('snacks','🥔','Chips & Dip',69,'Share-size chips',[G('Chips',['Salted','Masala','Cream & onion'],{req:1}),G('Dip',['Salsa','Cheese','Sour cream'],{req:1})],{veg:1}),

 I('sweet','🍫','Brownie',79,'Fudgy chocolate brownie',[G('Serve',[['Plain',0],['Warm + hot fudge',20],['With ice cream',45]],{req:1})],{veg:1}),
 I('sweet','🌋','Choco Lava Cake',99,'Molten chocolate centre',[G('Serve',[['Plain',0],['With ice cream',45]],{req:1})],{veg:1}),
 I('sweet','🍩','Donut',59,'Soft and glazed',[G('Flavour',['Glazed','Chocolate','Strawberry','Cinnamon'],{req:1}),G('Pieces',[['1',0],['2',50],['4',140]],{req:1})],{veg:1}),
 I('sweet','🥖','Churros',99,'Cinnamon churros with dip',[G('Dip',['Chocolate','Caramel','Strawberry'],{req:1}),G('Pieces',[['4 pcs',0],['8 pcs',70]],{req:1})],{veg:1}),
 I('sweet','🧇','Waffle',129,'Fresh waffle with toppings',[G('Topping',['Chocolate','Honey & butter','Strawberry','Maple'],{req:1}),G('Extras',[['Ice cream scoop',40],['Whipped cream',15],['Nuts',20]],{multi:1})],{veg:1}),
 I('sweet','🧁','Red Velvet Cupcake',79,'Cream-cheese frosting',[],{veg:1}),
 I('sweet','🍪','Cookies (3 pcs)',69,'Baked fresh today',[G('Type',['Choco chip','Oatmeal raisin','Double chocolate'],{req:1})],{veg:1}),
 I('sweet','🍬','Candy & Gummies',49,'Sweet share pack',[G('Type',['Gummy bears','Jelly hearts','Sour mix','Chocolate drops'],{req:1})],{veg:1}),
 I('sweet','🍭','Cotton Candy',59,'Spun fresh',[G('Colour',['Pink','Blue','Mixed'],{req:1})],{veg:1}),
 I('sweet','🍓','Fruit Cup',89,'Seasonal fresh fruit',[G('Extras',[['Chaat masala',0],['Honey drizzle',10],['Whipped cream',15]],{multi:1})],{veg:1})];


/* ---- curated: only the best-looking items stay; prices are converted to Gold Coins (about 1 coin per ₹10 of the old price) ---- */
const BEST=new Set(['Popcorn','Love Bucket (heart, reusable)','Cheese Popcorn Boat','Couple Combo','Date Night Combo','Sweetheart Combo','Snack Feast Combo',
 'Cola','Mango Shake','Cold Coffee','Chocolate Shake','Strawberry Shake','Fresh Lime Juice','Cappuccino','Masala Chai','Hot Chocolate',
 'Ice Cream','Couple Heart Sundae (for two)','Brownie Sundae','Kulfi','Nachos','French Fries','Samosa (2 pcs)','Burger','Pizza Slice','Grilled Sandwich',
 'Brownie','Choco Lava Cake','Donut','Churros','Waffle','Cookies (3 pcs)']);
const COIN=n=>Math.max(1,Math.round(n/10)),OPT=n=>n>0?Math.ceil(n/10):0;
export const MENU=RAW.filter(i=>BEST.has(i.name)).map(i=>({...i,price:COIN(i.price),groups:i.groups.map(g=>({...g,opts:g.opts.map(o=>({n:o.n,p:OPT(o.p)}))}))}));
export const slug=n=>String(n).toLowerCase().replace(/\(.*?\)/g,'').replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
