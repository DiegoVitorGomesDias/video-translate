// Contexto da tradução e da transcrição: nomes próprios e termos tirados do título da
// aba (ex.: "Prime Video: Dr. House" → "Dr. House", "House") ou digitados pelo usuário.
//
// - extractTermsFromTitle / parseGlossary / mergeTerms: montam a lista de termos;
// - protectTerms: a tradução mantém os termos como estão (ver translate/contextual.ts);
// - correctTranscript: a transcrição corrige palavras parecidas para a grafia do termo.
//
// Arquivo único (sem imports relativos) para rodar nos testes com node --experimental-strip-types.

// ---- Palavras inglesas frequentes ----
// As ~5.500 palavras mais frequentes do inglês (lista do pacote npm
// most-common-words-by-language, MIT) mais termos típicos de títulos de vídeo. Um termo do
// título que esteja aqui só vira contexto quando for o próprio nome da obra ou estiver
// com maiúscula no meio de um título em "sentence case"; e nunca é usado para correção
// aproximada da transcrição.

/** As 2.000 mais frequentes: nunca recebem correção aproximada na transcrição. */
const CORE_WORDS_TEXT = `
the of and to in for is on that by this with you it not or be are from at as your all have new more an was we
will home can us about if page my has search free but our one other do no information time they site he up may
what which their news out use any there see only so his when contact here business who web also now help get
pm view online first am been would how were me services some these click its like service than find price date
back top people had list name just over state year day into email two health world re next used go work last
most products music buy data make them should product system post her city add policy number such please
available copyright support message after best software then jan good video well where info rights public
books high school through each links she review years order very privacy book items company read group sex
need many user said de does set under general research university january mail full map reviews program life
know games way days management part could great united hotel real item international center ebay must store
travel comments made development report off member details line terms before hotels did send right type
because local those using results office education national car design take posted internet address community
within states area want phone dvd shipping reserved subject between forum family long based code show even
black check special prices website index being women much sign file link open today technology south case
project same pages uk version section own found sports house related security both county american photo game
members power while care network down computer systems three total place end following download him without
per access think north resources current posts big media law control water history pictures size art personal
since including guide shop directory board location change white text small rating rate government children
during usa return students shopping account times sites level digital profile previous form events love old
john main call hours image department title description non insurance another why shall property class cd
still money quality every listing content country private little visit save tools low reply customer december
compare movies include college value article york man card jobs provide food source author different press
learn sale around print course job canada process teen room stock training too credit point join science men
categories advanced west sales look english left team estate box conditions select windows photos gay thread
week category note live large gallery table register however june october november market library really
action start series model features air industry plan human provided tv yes required second hot accessories
cost movie forums march la september better say questions july yahoo going medical test friend come dec server
pc study application cart staff articles san feedback again play looking issues april never users complete
street topic comment financial things working against standard tax person below mobile less got blog party
payment equipment login student let programs offers legal above recent park stores side act problem red give
memory performance social august quote language story sell options experience rates create key body young
america important field few east paper single ii age activities club example girls additional password latest
something road gift question changes night ca hard texas oct pay four poker status browse issue range building
seller court february always result audio light write war nov offer blue groups al easy given files event
release analysis request fax china making picture needs possible might professional yet month major star areas
future space committee hand sun cards problems london washington meeting rss become interest id child keep
enter california porn share similar garden schools million added reference companies listed baby learning
energy run delivery net popular term film stories put computers journal reports co try welcome central images
president notice god original head radio until cell color self council away includes track australia
discussion archive once others entertainment agreement format least society months log safety friends sure faq
trade edition cars messages marketing tell further updated association able having provides david fun already
green studies close common drive specific several gold feb living sep collection called short arts lot ask
display limited powered solutions means director daily beach past natural whether due et electronics five upon
period planning database says official weather mar land average done technical window france pro region island
record direct microsoft conference environment records st district calendar costs style url front statement
update parts aug ever downloads early miles sound resource present applications either ago document word works
material bill apr written talk federal hosting rules final adult tickets thing centre requirements via cheap
nude kids finance true minutes else mark third rock gifts europe reading topics bad individual tips plus auto
cover usually edit together videos percent fast function fact unit getting global tech meet far economic en
player projects lyrics often subscribe submit germany amount watch included feel though bank risk thanks
everything deals various words linux jul production commercial james weight town heart advertising received
choose treatment newsletter archives points knowledge magazine error camera jun girl currently construction
toys registered clear golf receive domain methods chapter makes protection policies loan wide beauty manager
india position taken sort listings models michael known half cases step engineering florida simple quick none
wireless license paul friday lake whole annual published later basic sony shows corporate google church method
purchase customers active response practice hardware figure materials fire holiday chat enough designed along
among death writing speed html countries loss face brand discount higher effects created remember standards
oil bit yellow political increase advertise kingdom base near environmental thought stuff french storage oh
japan doing loans shoes entry stay nature orders availability africa summary turn mean growth notes agency
king monday european activity copy although drug pics western income force cash employment overall bay river
commission ad package contents seen players engine port album regional stop supplies started administration
bar institute views plans double dog build screen exchange types soon sponsored lines electronic continue
across benefits needed season apply someone held ny anything printer condition effective believe organization
effect asked eur mind sunday selection casino pdf lost tour menu volume cross anyone mortgage hope silver
corporation wish inside solution mature role rather weeks addition came supply nothing certain usr executive
running lower necessary union jewelry according dc clothing mon com particular fine names robert homepage hour
gas skills six bush islands advice career military rental decision leave british teens pre huge sat woman
facilities zip bid kind sellers middle move cable opportunities taking values division coming tuesday object
lesbian appropriate machine logo length actually nice score statistics client ok returns capital follow sample
investment sent shown saturday christmas england culture band flash ms lead george choice went starting
registration fri thursday courses consumer hi airport foreign artist outside furniture levels channel letter
mode phones ideas wednesday structure fund summer allow degree contract button releases wed homes super male
matter custom virginia almost took located multiple asian distribution editor inn industrial cause potential
song cnet ltd los hp focus late fall featured idea rooms female responsible inc communications win associated
thomas primary cancer numbers reason tool browser spring foundation answer voice eg friendly schedule
documents communication purpose feature bed comes police everyone independent ip approach cameras brown
physical operating hill maps medicine deal hold ratings chicago forms glass happy tue smith wanted developed
thank safe unique survey prior telephone sport ready feed animal sources mexico population pa regular secure
navigation operations therefore ass simply evidence station christian round paypal favorite understand option
master valley recently probably thu rentals sea built publications blood cut worldwide improve connection
publisher hall larger anti networks earth parents nokia impact transfer introduction kitchen strong tel
carolina wedding properties hospital ground overview ship accommodation owners disease tx excellent paid italy
perfect hair opportunity kit classic basis command cities william express anal award distance tree peter
assessment ensure thus wall ie involved el extra especially interface pussy partners budget rated guides
success maximum ma operation existing quite selected boy amazon patients restaurants beautiful warning wine
locations horse vote forward flowers stars significant lists technologies owner retail animals useful directly
manufacturer ways est son providing rule mac housing takes iii gmt bring catalog searches max trying mother
authority considered told xml traffic programme joined input strategy feet agent valid bin modern senior
ireland sexy teaching door grand testing trial charge units instead canadian cool normal wrote enterprise
ships entire educational md leading metal positive fl fitness chinese opinion mb asia football abstract uses
output funds mr greater likely develop employees artists alternative processing responsibility resolution java
guest seems publication pass relations trust van contains session multi photography republic fees components
vacation century academic assistance completed skin graphics indian prev ads mary il expected ring grade
dating pacific mountain organizations pop filter mailing vehicle longer consider int northern behind panel
floor german buying match proposed default require iraq boys outdoor deep morning otherwise allows rest
protein plant reported hit transportation mm pool mini politics partner disclaimer authors boards faculty
parties fish membership mission eye string sense modified pack released stage internal goods recommended born
unless richard detailed japanese race approved background target except character usb maintenance ability
maybe functions ed moving brands places php pretty trademarks phentermine spain southern yourself etc winter
rape battery youth pressure submitted boston incest debt keywords medium television interested core break
purposes throughout sets dance wood msn itself defined papers playing awards fee studio reader virtual device
established answers rent las remote dark programming external apple le regarding instructions min offered
theory enjoy remove aid surface minimum visual host variety teachers isbn martin manual block subjects agents
increased repair fair civil steel understanding songs fixed wrong beginning hands associates finally az
updates desktop classes paris ohio gets sector capacity requires jersey un fat fully father electric saw
instruments quotes officer driver businesses dead respect unknown specified restaurant mike trip pst worth mi
procedures poor teacher xxx eyes relationship workers farm fucking georgia peace traditional campus tom
showing creative coast benefit progress funding devices lord grant sub agree fiction hear sometimes watches
careers beyond goes families led museum themselves fan transport interesting blogs wife evaluation accepted
former implementation ten hits zone complex th cat galleries references die presented jack flat flow agencies
literature respective parent spanish michigan columbia setting dr scale stand economy highest helpful monthly
critical frame musical definition secretary angeles networking path australian employee chief gives kb bottom
magazines packages detail francisco laws changed pet heard begin individuals colorado royal clean switch
russian largest african guy titles relevant guidelines justice connect bible dev cup basket applied weekly vol
installation described demand pp suite vegas na square chris attention advance skip diet army auction gear lee
os difference allowed correct charles nation selling lots piece sheet firm seven older illinois regulations
elements species jump cells module resort facility random pricing dvds certificate minister motion looks
fashion directions visitors documentation monitor trading forest calls whose coverage couple giving chance
vision ball ending clients actions listen discuss accept automotive naked goal successful sold wind
communities clinical situation sciences markets lowest highly publishing appear emergency developing lives
currency leather determine milf temperature palm announcements patient actual historical stone bob commerce
ringtones perhaps persons difficult scientific satellite fit tests village accounts amateur ex met pain xbox
particularly factors coffee www settings cum buyer cultural steve easily oral ford poster edge functional root
au fi closed holidays ice pink zealand balance monitoring graduate replies shot nc architecture initial label
thinking scott llc sec recommend canon hardcore league waste minute bus provider optional dictionary cold
accounting manufacturing sections chair fishing effort phase fields bag fantasy po letters motor va professor
context install shirt apparel generally continued foot mass crime count breast techniques ibm rd johnson sc
quickly dollars websites religion claim driving permission surgery patch
`;

/** Da 2.001ª à 5.500ª: contam como comuns na leitura do título, mas podem ser nomes (Wilson, Chase). */
const MORE_WORDS_TEXT = `
heat wild measures generation kansas miss chemical doctor task reduce brought himself nor component enable
exercise bug santa mid guarantee leader diamond israel se processes soft servers alone meetings seconds jones
arizona keyword interests flight congress fuel username walk fuck produced italian paperback classifieds wait
supported pocket saint rose freedom argument competition creating jim drugs joint premium providers fresh
characters attorney upgrade di factor growing thousands km stream apartments pick hearing eastern auctions
therapy entries dates generated signed upper administrative serious prime samsung limit began louis steps
errors shops bondage del efforts informed ga ac thoughts creek ft worked quantity urban practices sorted
reporting essential myself tours platform load affiliate labor immediately admin nursing defense machines
designated tags heavy covered recovery joe guys integrated configuration cock merchant comprehensive expert
universal protect drop solid cds presentation languages became orange compliance vehicles prevent theme rich
im campaign marine improvement vs guitar finding pennsylvania examples ipod saying spirit ar claims porno
challenge motorola acceptance strategies mo seem affairs touch intended towards sa goals hire election suggest
branch charges serve affiliates reasons magic mount smart talking gave ones latin multimedia xp tits avoid
certified manage corner rank computing oregon element birth virus abuse interactive requests separate quarter
procedure leadership tables define racing religious facts breakfast kong column plants faith chain developer
identify avenue missing died approximately domestic sitemap recommendations moved houston reach comparison
mental viewed moment extended sequence inch attack sorry centers opening damage lab reserve recipes cvs gamma
plastic produce snow placed truth counter failure follows eu weekend dollar camp ontario automatically des
minnesota films bridge native fill williams movement printing baseball owned approval draft chart played
contacts cc jesus readers clubs lcd wa jackson equal adventure matching offering shirts profit leaders posters
institutions assistant variable ave dj advertisement expect parking headlines yesterday compared determined
wholesale workshop russia gone codes kinds extension seattle statements golden completely teams fort cm wi
lighting senate forces funny brother gene turned portable tried electrical applicable disc returned pattern ct
hentai boat named theatre laser earlier manufacturers sponsor classical icon warranty dedicated indiana
direction harry basketball objects ends delete evening assembly nuclear taxes mouse signal criminal issued
brain sexual wisconsin powerful dream obtained false da cast flower felt personnel passed supplied identified
falls pic soul aids opinions promote stated stats hawaii professionals appears carry flag decided nj covers hr
em advantage hello designs maintain tourism priority newsletters adults clips savings iv graphic atom payments
rw estimated binding brief ended winning eight anonymous iron straight script served wants miscellaneous
prepared void dining alert integration atlanta dakota tag interview mix framework disk installed queen vhs
credits clearly fix handle sweet desk criteria pubmed dave massachusetts diego hong vice associate ne truck
behavior enlarge ray frequently revenue measure changing votes du duty looked discussions bear gain festival
laboratory ocean flights experts signs lack depth iowa whatever logged laptop vintage train exactly dry
explore maryland spa concept nearly eligible checkout reality forgot handling origin knew gaming feeds billion
destination scotland faster intelligence dallas bought con ups nations route followed specifications broken
tripadvisor frank alaska zoom blow battle residential anime speak decisions industries protocol query clip
partnership editorial nt expression es equity provisions speech wire principles suggestions rural shared
sounds replacement tape strategic judge spam economics acid bytes cent forced compatible fight apartment
height null zero speaker filed gb netherlands obtain bc consulting recreation offices designer remain managed
pr failed marriage roll korea banks fr participants secret bath aa kelly leads negative austin favorites
toronto theater springs missouri andrew var perform healthy translation estimates font assets injury mt joseph
ministry drivers lawyer figures married protected proposal sharing philadelphia portal waiting birthday beta
fail gratis banking officials brian toward won slightly assist conduct contained lingerie shemale legislation
calling parameters jazz serving bags profiles miami comics matters houses doc postal relationships tennessee
wear controls breaking combined ultimate wales representative frequency introduced minor finish departments
residents noted displayed mom reduced physics rare spent performed extreme samples davis daniel bars reviewed
row oz forecast removed helps singles administrator cycle amounts contain accuracy dual rise usd sleep mg bird
pharmacy brazil creation static scene hunter addresses lady crystal famous writer chairman violence fans
oklahoma speakers drink academy dynamic gender eat permanent agriculture dell cleaning constitutes portfolio
practical delivered collectibles infrastructure exclusive seat concerns colour vendor originally intel
utilities philosophy regulation officers reduction aim bids referred supports nutrition recording regions
junior toll les cape ann rings meaning tip secondary wonderful mine ladies henry ticket announced guess agreed
prevention whom ski soccer math import posting presence instant mentioned automatic healthcare viewing
maintained ch increasing majority connected christ dan dogs sd directors aspects austria ahead moon
participation scheme utility preview fly manner matrix containing combination devel amendment despite strength
guaranteed turkey libraries proper distributed degrees singapore enterprises delta fear seeking inches phoenix
rs convention shares principal daughter standing voyeur comfort colors wars cisco ordering kept alpha appeal
cruise bonus certification previously hey bookmark buildings specials beat disney household batteries adobe
smoking bbc becomes drives arms alabama tea improved trees avg achieve positions dress subscription dealer
contemporary sky utah nearby rom carried happen exposure panasonic hide permalink signature gambling refer
miller provision outdoors clothes caused luxury babes frames viagra certainly indeed newspaper toy circuit
layer printed slow removal easier src liability trademark hip printers faqs nine adding kentucky mostly eric
spot taylor trackback prints spend factory interior revised grow americans optical promotion relative amazing
clock dot hiv identity suites conversion feeling hidden reasonable victoria serial relief revision broadband
influence ratio pda importance rain onto dsl planet webmaster copies recipe zum permit seeing proof dna diff
tennis bass prescription bedroom empty instance hole pets ride licensed orlando specifically tim bureau maine
sql represent conservation pair ideal specs recorded don pieces finished parks dinner lawyers sydney stress
cream ss runs trends yeah discover sexo ap patterns boxes louisiana hills javascript fourth nm advisor mn
marketplace nd evil aware wilson shape evolution irish certificates objectives stations suggested gps op
remains acc greatest firms concerned euro operator structures generic encyclopedia usage cap ink charts
continuing mixed census interracial peak tn competitive exist wheel transit dick suppliers salt compact poetry
lights tracking angel bell keeping preparation attempt receiving matches accordance width noise engines forget
array discussed accurate stephen elizabeth climate reservations pin playstation alcohol greek instruction
managing annotation sister raw differences walking explain smaller newest establish gnu happened expressed
jeff extent sharp lesbians ben lane paragraph kill mathematics aol compensation ce export managers aircraft
modules sweden conflict conducted versions employer occur percentage knows mississippi describe concern backup
requested citizens connecticut heritage personals immediate holding trouble spread coach kevin agricultural
expand supporting audience assigned jordan collections ages participate plug specialist cook affect virgin
experienced investigation raised hat institution directed dealers searching sporting helping perl affected lib
bike totally plate expenses indicate blonde ab proceedings favourite transmission anderson utc characteristics
der lose organic seek experiences albums cheats extremely verzeichnis contracts guests hosted diseases
concerning developers equivalent chemistry tony neighborhood nevada kits thailand variables agenda anyway
continues tracks advisory cam curriculum logic template prince circle soil grants anywhere psychology
responses atlantic wet circumstances edward investor identification ram leaving wildlife appliances matt
elementary cooking speaking sponsors fox unlimited respond sizes plain exit entered iran arm keys launch wave
checking costa belgium printable holy acts guidance mesh trail enforcement symbol crafts highway buddy
hardcover observed dean setup poll booking glossary fiscal celebrity styles denver unix filled bond channels
ericsson appendix notify blues chocolate pub portion scope hampshire supplier cables cotton bluetooth
controlled requirement authorities biology dental killed border ancient debate representatives starts
pregnancy causes arkansas biography leisure attractions learned transactions notebook explorer historic
attached opened tm husband disabled authorized crazy upcoming britain concert retirement scores financing
efficiency sp comedy adopted efficient weblog linear commitment specialty bears jean hop carrier edited
constant visa mouth jewish meter linked portland interviews concepts nh gun reflect pure deliver wonder hell
lessons fruit begins qualified reform lens alerts treated discovery draw mysql classified relating assume
confidence alliance fm confirm warm neither lewis howard offline leaves engineer lifestyle consistent replace
clearance connections inventory converter suck organisation babe checks reached becoming blowjob safari
objective indicated sugar crew legs sam stick securities allen pdt relation enabled genre slide montana
volunteer tested rear democratic enhance switzerland exact bound parameter adapter processor node formal
dimensions contribute lock hockey storm micro colleges laptops mile showed challenges editors mens threads
bowl supreme brothers recognition presents ref tank submission dolls estimate encourage navy kid regulatory
inspection consumers cancel limits territory transaction manchester weapons paint delay pilot outlet
contributions continuous db czech resulting cambridge initiative novel pan execution disability increases
ultra winner idaho contractor ph episode examination potter dish plays bulletin ia pt indicates modify oxford
adam truly epinions painting committed extensive affordable universe candidate databases patent slot psp
outstanding ha eating perspective planned watching lodge messenger mirror tournament consideration ds
discounts sterling sessions kernel boobs stocks buyers journals gray catalogue ea jennifer antonio charged
broad taiwan und chosen demo greece lg swiss sarah clark labour hate terminal publishers nights behalf
caribbean liquid rice nebraska loop salary reservation foods gourmet guard properly orleans saving nfl
remaining empire resume twenty newly raise prepare avatar gary depending illegal expansion vary hundreds rome
arab lincoln helped premier tomorrow purchased milk decide consent drama visiting performing downtown keyboard
contest collected nw bands boot suitable ff absolutely millions lunch dildo audit push chamber guinea findings
muscle featuring iso implement clicking scheduled polls typical tower yours sum misc calculator significantly
chicken temporary attend shower alan sending jason tonight dear sufficient holdem shell province catholic oak
vat awareness vancouver governor beer seemed contribution measurement swimming spyware formula constitution
packaging solar jose catch jane pakistan ps reliable consultation northwest sir doubt earn finder unable
periods classroom tasks democracy attacks kim wallpaper merchandise const resistance doors symptoms resorts
biggest memorial visitor twin forth insert baltimore gateway ky dont alumni drawing candidates charlotte
ordered biological fighting transition happens preferences spy romance instrument bruce split themes powers
heaven br bits pregnant twice classification focused egypt physician hollywood bargain wikipedia cellular
norway vermont asking blocks normally lo spiritual hunting diabetes suit ml shift chip res sit bodies
photographs cutting wow simon writers marks flexible loved favourites mapping numerous relatively birds
satisfaction represents char indexed pittsburgh superior preferred saved paying cartoon shots intellectual
moore granted choices carbon spending comfortable magnetic interaction listening effectively registry crisis
outlook massive denmark employed bright treat header cs poverty formed piano echo que grid sheets patrick
experimental puerto revolution consolidation displays plasma allowing earnings voip mystery landscape
dependent mechanical journey delaware bidding consultants risks banner applicant charter fig barbara
cooperation counties acquisition ports implemented sf directories recognized dreams blogger notification kg
licensing stands teach occurred textbooks rapid pull hairy diversity cleveland ut reverse deposit seminar
investments latina nasa wheels sexcam specify accessibility dutch sensitive templates formats tab depends
boots holds router concrete si editing poland folder womens css completion upload pulse universities technique
contractors milfhunter voting courts notices subscriptions calculate mc detroit alexander broadcast converted
metro toshiba anniversary improvements strip specification pearl accident nick accessible accessory resident
plot qty possibly airline typically representation regard pump exists arrangements smooth conferences
uniprotkb beastiality strike consumption birmingham flashing lp narrow afternoon threat surveys sitting
putting consultant controller ownership committees penis legislative researchers vietnam trailer anne castle
gardens missed malaysia unsubscribe antique labels willing bio molecular upskirt acting heads stored exam
logos residence attorneys milfs antiques density hundred ryan operators strange sustainable philippines
statistical beds breasts mention innovation pcs employers grey parallel honda amended operate bills bold
bathroom stable opera definitions von doctors lesson cinema asset ag scan elections drinking blowjobs reaction
blank enhanced entitled severe generate stainless newspapers hospitals vi deluxe humor aged monitors exception
lived duration bulk successfully indonesia pursuant sci fabric edt visits primarily tight domains capabilities
pmid contrast recommendation flying recruitment sin berlin cute organized ba para siemens adoption improving
cr expensive meant capture pounds buffalo organisations plane pg explained seed programmes desire expertise
mechanism camping ee jewellery meets welfare peer caught eventually marked driven measured medline bottle
agreements considering innovative marshall massage rubber conclusion closing tampa thousand meat legend grace
susan ing ks adams python monster alex bang villa bone columns disorders bugs collaboration hamilton detection
ftp cookies inner formation tutorial med engineers entity cruises gate holder proposals moderator sw tutorials
settlement portugal lawrence roman duties valuable erotic tone collectables ethics forever dragon busy captain
fantastic imagine brings heating leg neck hd wing governments purchasing scripts abc stereo appointed taste
dealing commit tiny operational rail airlines liberal livecam jay trips gap sides tube turns corresponding
descriptions cache belt jacket determination animation oracle er matthew lease productions aviation hobbies
proud excess disaster console commands jr telecommunications instructor giant achieved injuries shipped
bestiality seats approaches biz alarm voltage anthony nintendo usual loading stamps appeared franklin angle
rob vinyl highlights mining designers melbourne ongoing worst imaging betting scientists liberty wyoming
blackjack argentina era convert possibility analyst commissioner dangerous garage exciting reliability thongs
gcc unfortunately respectively volunteers attachment ringtone finland morgan derived pleasure honor asp
oriented eagle desktops pants columbus nurse prayer appointment workshops hurricane quiet luck postage
producer represented mortgages dial responsibilities cheese comic carefully jet productivity investors crown
par underground diagnosis maker crack principle picks vacations gang semester calculated cumshot fetish
applies casinos appearance smoke apache filters incorporated nv craft cake notebooks apart fellow blind lounge
mad algorithm semi coins andy gross strongly cafe valentine hilton ken proteins horror su exp familiar capable
douglas debian till involving pen investing christopher admission epson shoe elected carrying victory sand
madison terrorism joy editions cpu mainly ethnic ran parliament actor finds seal situations fifth allocated
citizen vertical corrections structural municipal describes prize sr occurs jon absolute disabilities consists
anytime substance prohibited addressed lies pipe soldiers nr guardian lecture simulation layout initiatives
ill concentration classics lbs lay interpretation horses lol dirty deck wayne donate taught bankruptcy mp
worker optimization alive temple substances prove discovered wings breaks genetic restrictions participating
waters promise thin exhibition prefer ridge cabinet modem harris mph bringing sick dose evaluate tiffany
tropical collect bet composition toyota streets nationwide vector definitely shaved turning buffer purple
existence commentary larry limousines developments def immigration destinations lets mutual pipeline
necessarily syntax li attribute prison skill chairs nl everyday apparently surrounding mountains moves
popularity inquiry ethernet checked exhibit throw trend sierra visible cats desert postposted ya oldest rhode
nba busty coordinator obviously mercury steven handbook greg navigate worse summit victims epa spaces
fundamental burning escape coupons somewhat receiver substantial tr progressive cialis bb boats glance
scottish championship arcade richmond sacramento impossible ron russell tells obvious fiber depression graph
covering platinum judgment bedrooms talks filing foster modeling passing awarded testimonials trials tissue nz
memorabilia clinton masters bonds cartridge alberta explanation folk org commons cincinnati subsection fraud
electricity permitted spectrum arrival okay pottery emphasis roger aspect workplace awesome mexican confirmed
counts priced wallpapers hist crash lift desired inter closer assumes heights shadow riding infection firefox
lisa expense grove eligibility venture clinic korean healing princess mall entering packet spray studios
involvement dad buttons placement observations vbulletin funded thompson winners extend roads subsequent pat
dublin rolling fell motorcycle yard disclosure establishment memories nelson te arrived creates faces tourist
cocks av mayor murder sean adequate senator yield presentations grades cartoons pour digest reg lodging tion
dust hence wiki entirely replaced radar rescue undergraduate losses combat reducing stopped occupation lakes
butt donations associations citysearch closely radiation diary seriously kings shooting kent adds nsw ear
flags pci baker launched elsewhere pollution conservative guestbook shock effectiveness walls abroad ebony tie
ward drawn arthur ian visited roof walker demonstrate atmosphere suggests kiss beast ra operated experiment
targets overseas purchases dodge counsel federation pizza invited yards assignment chemicals gordon mod
farmers rc queries bmw rush ukraine absence nearest cluster vendors mpeg whereas yoga serves woods surprise
lamp rico partial shoppers phil everybody couples nashville ranking jokes cst http ceo simpson twiki sublime
counseling palace acceptable satisfied glad wins measurements verify globe trusted copper milwaukee rack
medication warehouse shareware ec rep dicke kerry receipt supposed ordinary nobody ghost violation configure
stability mit applying southwest boss pride institutional expectations independence knowing reporter
metabolism keith champion cloudy linda ross personally chile anna plenty solo sentence throat ignore maria
uniform excellence wealth tall rm somewhere vacuum dancing attributes recognize brass writes plaza pdas
outcomes survival quest publish sri screening toe thumbnail trans jonathan whenever nova lifetime api pioneer
booty forgotten acrobat plates acres venue athletic thermal essays behaviour vital telling fairly coastal
config cf charity intelligent edinburgh vt excel modes obligation campbell wake stupid harbor hungary traveler
urw segment realize regardless lan enemy puzzle rising aluminum wells wishlist opens insight sms shit
restricted republican secrets lucky latter merchants thick trailers repeat syndrome philips attendance penalty
drum glasses enables nec iraqi builder vista jessica chips terry flood foto ease arguments amsterdam orgy
arena adventures pupils stewart announcement tabs outcome xx appreciate expanded casual grown polish lovely
extras gm centres jerry clause smile lands ri troops indoor bulgaria armed broker charger regularly believed
pine cooling tend gulf rt rick trucks cp mechanisms divorce laura shopper tokyo partly nikon customize
tradition candy pills tiger donald folks sensor exposed telecom hunt angels deputy indicators sealed thai
emissions physicians loaded fred complaint scenes experiments balls afghanistan dd boost spanking scholarship
governance mill founded supplements chronic icons tranny moral den catering aud finger keeps pound locate
camcorder pl trained burn implementing roses labs ourselves bread tobacco wooden motors tough roberts incident
gonna dynamics lie crm rf conversation decrease cumshots chest pension billy revenues emerging worship bukkake
capability ak fe craig herself producing churches precision damages reserves contributed solve shorts
reproduction minority td diverse amp ingredients sb ah johnny sole franchise recorder complaints facing sm
nancy promotions tones passion rehabilitation maintaining sight laid clay defence patches weak refund usc
towns environments trembl divided blvd reception amd wise emails cyprus wv odds correctly insider seminars
consequences makers hearts geography appearing integrity worry ns discrimination eve carter legacy marc
pleased danger vitamin widely processed phrase genuine raising implications functionality paradise hybrid
reads roles intermediate emotional sons leaf pad glory platforms ja bigger billing diesel versus combine
overnight geographic exceed bs rod saudi fault cuba hrs preliminary districts introduce silk promotional kate
chevrolet babies bi karen compiled romantic revealed specialists generator albert examine jimmy graham
suspension bristol margaret compaq sad correction wolf slowly authentication communicate rugby supplement
showtimes cal portions infant promoting sectors samuel fluid grounds fits kick regards meal ta hurt machinery
bandwidth unlike equation baskets probability pot dimension wright img barry proven schedules admissions
cached warren slip studied reviewer involves quarterly rpm profits devil grass comply marie florist
illustrated cherry continental alternate deutsch achievement limitations kenya webcam cuts funeral nutten
earrings enjoyed automated chapters pee charlie quebec nipples passenger convenient dennis mars francis tvs
sized manga noticed socket silent literary egg mhz signals caps orientation pill theft childhood swing symbols
lat meta humans analog facial choosing talent dated flexibility seeker wisdom shoot boundary mint packard
offset payday philip elite gi spin holders believes swedish poems deadline jurisdiction robot displaying
witness collins equipped stages encouraged sur winds powder broadway acquired assess wash cartridges stones
entrance gnome roots declaration losing attempts gadgets noble glasgow automation impacts rev gospel
advantages shore loves induced ll knight preparing loose aims recipient linking extensions appeals cl earned
illness islamic athletics southeast ieee ho alternatives pending parker determining lebanon corp personalized
kennedy gt sh conditioning teenage soap ae triple cooper nyc vincent jam secured unusual answered partnerships
destruction slots increasingly migration disorder routine toolbar basically rocks conventional titans
applicants wearing axis sought genes mounted habitat firewall median guns scanner herein occupational animated
horny judicial rio hs adjustment hero integer treatments bachelor attitude camcorders engaged falling basics
montreal carpet rv struct lenses binary genetics attended difficulty punk collective coalition pi dropped
enrollment duke walter ai pace besides wage producers ot collector arc hosts interfaces advertisers moments
atlas strings dawn representing observation feels torture carl deleted coat mitchell mrs rica restoration
convenience returning ralph opposition container yr defendant warner confirmation app embedded inkjet
supervisor wizard corps actors liver peripherals liable brochure morris bestsellers petition eminem recall
antenna picked assumed departure minneapolis belief killing bikini memphis shoulder decor lookup texts harvard
brokers roy ion diameter ottawa doll ic podcast tit seasons peru interactions refine bidder singer evans
herald literacy fails aging nike intervention pissing fed plugin attraction diving invite modification alice
latinas suppose customized reed involve moderate terror younger thirty mice opposite understood rapidly
dealtime ban temp intro mercedes zus assurance fisting clerk happening vast mills outline amendments tramadol
holland receives jeans metropolitan compilation verification fonts ent odd wrap refers mood favor veterans
quiz mx sigma gr attractive xhtml occasion recordings jefferson victim demands sleeping careful ext beam
gardening obligations arrive orchestra sunset tracked moreover minimal polyphonic lottery tops framed aside
outsourcing licence adjustable allocation michelle essay discipline amy ts demonstrated dialogue identifying
alphabetical camps declared dispatched aaron handheld trace disposal shut florists packs ge installing
switches romania voluntary ncaa thou consult phd greatly blogging mask cycling midnight ng commonly pe
photographer inform
`;

/** Palavras comuns em títulos de vídeo (YouTube, streaming): não são nomes próprios. */
const TITLE_WORDS = `
official trailer teaser episode episodes season seasons series show movie film clip clips scene scenes full hd uhd
lyrics lyric audio visualizer live acoustic remix cover version edition extended cut
tutorial guide course lesson lessons class explained explain explanation review reviews reaction reacts reacting unboxing
gameplay walkthrough playthrough speedrun stream streaming highlights compilation montage
part parts vol volume chapter ep temporada episódio episodio capítulo capitulo completo dublado legendado
vs versus feat ft featuring video
how why what when where which who a i
new best top ultimate complete beginner beginners advanced intermediate basics introduction intro crash
watch watching assistir ver online free download
minutes minute hours hour seconds second
`;

export const COMMON_WORDS: ReadonlySet<string> = new Set(`${CORE_WORDS_TEXT} ${MORE_WORDS_TEXT} ${TITLE_WORDS}`.split(/\s+/).filter(Boolean));
/** Palavras tão frequentes que uma parecida na transcrição é quase sempre outra palavra, não o nome. */
export const CORE_WORDS: ReadonlySet<string> = new Set(`${CORE_WORDS_TEXT} ${TITLE_WORDS}`.split(/\s+/).filter(Boolean));
/** Só as palavras de metadados de título (nunca fazem parte de um nome). */
const META_WORDS: ReadonlySet<string> = new Set(TITLE_WORDS.split(/\s+/).filter(Boolean));

export function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ''));
}

// ---- Título da aba → termos ----

/** Quantidade máxima de termos automáticos tirados do título. */
const MAX_AUTO_TERMS = 12;

/** Nomes de sites/serviços que aparecem nos títulos e não são contexto do vídeo. */
const SITE_NAMES = [
  'youtube', 'youtube music', 'prime video', 'amazon prime video', 'amazon.com', 'amazon.com.br', 'amazon', 'netflix',
  'netflix official site', 'disney+', 'disney plus', 'hbo max', 'max', 'hulu', 'paramount+', 'paramount plus', 'apple tv+',
  'apple tv', 'star+', 'globoplay', 'crunchyroll', 'twitch', 'vimeo', 'dailymotion', 'ted', 'coursera', 'udemy', 'khan academy',
  'peacock', 'pluto tv', 'tubi', 'plex', 'rakuten viki', 'viki', 'claro tv+', 'looke', 'mubi', 'official site',
];

/** Segmentos do título que são metadados, não nomes. */
const JUNK_SEGMENT = [
  /^\(?\d+\)?$/, // "(3)" contador de notificações
  /^(season|temporada|series|episode|episódio|episodio|ep\.?|chapter|capítulo|capitulo|part|parte|vol\.?|volume)\s*\d+/i,
  /^s\d{1,2}\s*e\d{1,3}\b/i, // S01E02
  /^(watch|assistir|assista|ver|stream|streaming)$/i,
  /^(official|oficial)\s+(site|trailer|video|vídeo|audio|áudio|music video|lyric video)$/i,
  /^(full|complete)\s+(course|episode|movie|album|concert)$/i,
  /^(hd|4k|uhd|8k|1080p|720p|60fps)$/i,
  /^\d{4}$/, // ano
];

/** Títulos honoríficos que fazem parte do nome (não contam como "palavra comum"). */
const HONORIFICS = new Set(['dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'prof', 'prof.', 'sir', 'lady', 'lord', 'st', 'st.', 'capt', 'capt.', 'sgt', 'sgt.', 'doctor', 'professor', 'detective', 'agent', 'king', 'queen', 'prince', 'princess', 'm.d.', 'md', 'jr', 'jr.', 'sr', 'sr.', 'ph.d.', 'phd', 'ii', 'iii', 'iv']);

/** Conectores que podem ficar no meio de um nome composto ("Lord of the Rings"). */
const CONNECTORS = new Set(['of', 'the', 'and', '&', 'de', 'da', 'do', 'das', 'dos', 'e', 'du', 'von', 'van', 'del', 'la', 'le', 'y']);

const SEPARATORS = /\s+[-|–—·•:»«]\s+|\s*[|•»«]\s*|:\s+|\s+-\s+/;

/** Remove o nome do site/serviço e metadados do título da aba. */
export function cleanTitle(title: string): string[] {
  const parts = title
    .replace(/^\s*\(\d+\)\s*/, '') // "(3) Vídeo - YouTube"
    .replace(/^\s*(watch|assistir|assista|ver|stream)\s+/i, '') // "Watch House - Season 1"
    .split(SEPARATORS)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.filter((p) => {
    const low = p.toLowerCase().replace(/[™®]/g, '').trim();
    if (SITE_NAMES.includes(low)) return false;
    if (SITE_NAMES.some((s) => low === `${s} oficial` || low === `${s} official` || low === `assista ${s}` || low === `watch ${s}`)) return false;
    return !JUNK_SEGMENT.some((re) => re.test(p));
  });
}

interface Token {
  text: string;
  /** Começa com maiúscula (letra Unicode). */
  capitalized: boolean;
  /** Só letras/dígitos (ignora pontuação). */
  core: string;
}

function tokenize(segment: string): Token[] {
  return segment
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      // Tira aspas e pontuação das pontas, mas mantém "Dr." e apóstrofos internos.
      const text = raw.replace(/^[\s"'“”‘’(\[{¡¿]+|[\s"'“”‘’)\]},;!?…]+$/gu, '').replace(/\.$/, (m, off: number, s: string) => (HONORIFICS.has(s.toLowerCase()) || /\p{L}\.\p{L}/u.test(s) ? m : ''));
      const core = text.replace(/[^\p{L}\p{N}']/gu, '');
      return { text, capitalized: /^\p{Lu}/u.test(text) || (/^\p{N}/u.test(text) && /\p{Lu}/u.test(text)), core };
    })
    .filter((t) => t.core.length > 0);
}

function isHonorific(t: Token): boolean {
  return HONORIFICS.has(t.text.toLowerCase());
}

function isCommon(t: Token): boolean {
  return COMMON_WORDS.has(t.core.toLowerCase());
}

function isMeta(t: Token): boolean {
  return META_WORDS.has(t.core.toLowerCase());
}

function isWord(t: Token): boolean {
  return /\p{L}/u.test(t.core);
}

/** Sequências de palavras com maiúscula (com honoríficos e conectores no meio). */
function capitalizedRuns(tokens: Token[]): Token[][] {
  const runs: Token[][] = [];
  let run: Token[] = [];
  const flush = () => {
    // Conectores nas pontas não fazem parte do nome.
    while (run.length && CONNECTORS.has(run[run.length - 1]!.text.toLowerCase())) run.pop();
    while (run.length && CONNECTORS.has(run[0]!.text.toLowerCase()) && !run[0]!.capitalized) run.shift();
    if (run.length) runs.push(run);
    run = [];
  };
  for (const t of tokens) {
    if (!isWord(t) || (isMeta(t) && !isHonorific(t))) {
      flush();
      continue;
    }
    if (t.capitalized || isHonorific(t)) run.push(t);
    else if (run.length && CONNECTORS.has(t.text.toLowerCase())) run.push(t);
    else flush();
  }
  flush();
  return runs;
}

/** Dentro de uma sequência com maiúsculas, as subsequências de palavras incomuns (honoríficos e conectores no meio valem). */
function uncommonSubRuns(run: Token[]): Token[][] {
  const subs: Token[][] = [];
  let cur: Token[] = [];
  const flush = () => {
    while (cur.length && CONNECTORS.has(cur[cur.length - 1]!.text.toLowerCase())) cur.pop();
    if (cur.length) subs.push(cur);
    cur = [];
  };
  for (let i = 0; i < run.length; i++) {
    const t = run[i]!;
    const conn = CONNECTORS.has(t.text.toLowerCase());
    if (isHonorific(t)) {
      flush();
      cur.push(t);
      const next = run[i + 1];
      if (next && !isHonorific(next)) {
        cur.push(next);
        i++;
      }
      flush();
    } else if (!isCommon(t) && !conn) cur.push(t);
    else if (conn && cur.length) cur.push(t);
    else flush();
  }
  flush();
  return subs;
}

/**
 * Extrai os termos de contexto do título de uma aba.
 *
 * Regras (conservadoras, para não "proteger" palavras comuns de títulos como
 * "How To Bake A Cake"):
 * - cada trecho entre separadores (" - ", " | ", ": ") é avaliado em separado, sem
 *   nomes de sites, "Watch"/"Assistir" e metadados (temporada, episódio, ano…);
 * - sequências de palavras com maiúscula viram um termo (ex.: "Dr. House", "Hugh Laurie");
 * - um trecho que é só um nome curto (até 3 palavras, ex.: "House", "Breaking Bad") é
 *   mantido mesmo sendo palavra comum, porque é o nome da obra;
 * - num trecho em "Title Case" (4+ palavras, quase todas com maiúscula) só sobram as
 *   palavras que não são comuns em inglês ("Hugh Laurie Interview" → "Hugh Laurie");
 * - num trecho em "sentence case", uma maiúscula fora do início é sinal de nome e é
 *   mantida mesmo em palavra comum ("Why House is the best doctor" → "House");
 * - de termos compostos curtos, cada palavra também entra sozinha
 *   ("Hugh Laurie" → "Hugh Laurie", "Hugh", "Laurie").
 */
export function extractTermsFromTitle(title: string): string[] {
  const out: string[] = [];
  const add = (term: string) => {
    const t = term.trim();
    if (t.length < 2 || /^\d+$/.test(t)) return;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  const joined = (ts: Token[]) => ts.map((t) => t.text).join(' ');
  const isConn = (t: Token) => CONNECTORS.has(t.text.toLowerCase());

  for (const segment of cleanTitle(title)) {
    const tokens = tokenize(segment);
    const words = tokens.filter(isWord);
    if (words.length === 0) continue;
    const capitalized = words.filter((t) => t.capitalized || isHonorific(t)).length;
    const titleCase = words.length >= 4 && capitalized / words.length >= 0.75;
    const runs = capitalizedRuns(tokens);
    const singleRun = runs.length === 1 && runs[0]!.length === words.length && words.length <= 3;

    for (let run of runs) {
      if (!singleRun && run[0] === tokens[0]) {
        // Início do trecho: a maiúscula pode ser só por ser o começo ("Why Hugh Laurie…").
        const rest = run.filter((t) => !isConn(t) && !isHonorific(t));
        const hasHon = run.some(isHonorific);
        if (!titleCase && rest.length < 2 && !hasHon) continue; // "Essence of linear algebra": ambíguo
        if (!titleCase && rest.length >= 2 && isCommon(run[0]!) && !isHonorific(run[0]!)) {
          // "Why Hugh Laurie…" → tira a primeira; "Jim and Pam…" fica inteiro se a primeira for incomum.
          run = run.slice(1);
          while (run.length && isConn(run[0]!)) run = run.slice(1);
          if (run.length === 0) continue;
        }
      }
      const meaningful = run.filter((t) => !isConn(t) && !isHonorific(t));
      if (meaningful.length === 0) continue;
      const hasHonorific = meaningful.length !== run.filter((t) => !isConn(t)).length;

      if (singleRun) {
        add(joined(run));
        if (hasHonorific) add(joined(meaningful));
        continue;
      }
      if (titleCase) {
        // Só sequências de 2+ palavras incomuns ("Hugh Laurie", "Stephen Colbert") ou
        // honorífico + nome ("Dr. Wilson"); uma palavra incomum sozinha ("Bake") é ambígua.
        for (const sub of uncommonSubRuns(run)) {
          const subMeaningful = sub.filter((t) => !isConn(t) && !isHonorific(t));
          const subHonorific = sub.some(isHonorific);
          if (subMeaningful.length < 2 && !subHonorific) continue;
          add(joined(sub));
          if (subHonorific && subMeaningful.length) add(joined(subMeaningful));
          if (subMeaningful.length <= 3) for (const t of subMeaningful) if (t.core.length >= 3 && !isCommon(t)) add(t.text);
        }
        continue;
      }
      // Sentence case: toda maiúscula fora do início conta.
      add(joined(run));
      if (hasHonorific) add(joined(meaningful));
      if (meaningful.length >= 2 && meaningful.length <= 3) for (const t of meaningful) if (t.core.length >= 3 && !isCommon(t)) add(t.text);
    }
  }
  return out.slice(0, MAX_AUTO_TERMS);
}

/** Lê o glossário digitado pelo usuário: um termo por linha, ou separados por vírgula/ponto e vírgula. */
export function parseGlossary(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const t = raw.trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/** Junta listas de termos sem repetição, maiores primeiro (para casar "Dr. House" antes de "House"). */
export function mergeTerms(...lists: string[][]): string[] {
  const out: string[] = [];
  for (const list of lists) for (const t of list) if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  return out.sort((a, b) => b.length - a.length);
}

// ---- Proteção na tradução ----
// Protege termos do glossário durante a tradução: troca cada ocorrência por um marcador
// que os tradutores (LibreTranslate, Chrome, opus-mt) copiam sem traduzir e, depois,
// devolve o termo original. Se o tradutor estragar algum marcador, `restore` devolve
// null e quem chamou deve usar a tradução sem proteção.

export interface ProtectedText {
  /** Texto com os marcadores no lugar dos termos (vazio de marcadores = nada a proteger). */
  text: string;
  /** Termos encontrados, na ordem dos marcadores. */
  hits: string[];
  /** Devolve os termos no texto traduzido; null se algum marcador sumiu ou mudou. */
  restore(translated: string): string | null;
}

/**
 * Marcadores numéricos (701, 702…): números são copiados fielmente por modelos Marian
 * (opus-mt/Argos) e pela Translator API, e não têm gênero, então a concordância fica
 * neutra ("701 está aqui" → "House está aqui"). O texto traduzido é verificado antes
 * de restaurar: cada marcador precisa aparecer exatamente uma vez.
 */
const BASE = 700;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex de palavra inteira para o termo, sensível a maiúsculas, tolerante a espaços múltiplos. */
export function termPattern(term: string, flags = 'gu'): RegExp {
  const body = term
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, flags);
}

/**
 * Substitui as ocorrências dos termos (palavra inteira, sensível a maiúsculas: "House"
 * sim, "house" não) por marcadores. Os termos devem vir do maior para o menor.
 */
export function protectTerms(text: string, terms: string[]): ProtectedText {
  const hits: string[] = [];
  let out = text;
  for (const term of terms) {
    if (!term.trim()) continue;
    const re = termPattern(term);
    out = out.replace(re, (m) => {
      hits.push(m);
      return String(BASE + hits.length);
    });
  }
  const restore = (translated: string): string | null => {
    if (hits.length === 0) return translated;
    let result = translated;
    for (let i = 0; i < hits.length; i++) {
      const marker = String(BASE + i + 1);
      // Tradutores às vezes escrevem "o 701" ou "701." — o número em si precisa estar intacto e único.
      const re = new RegExp(`(?<![\\p{N}.,])${marker}(?![\\p{N}])`, 'gu');
      const count = (result.match(re) ?? []).length;
      if (count !== 1) return null;
      result = result.replace(re, hits[i]!.replace(/\$/g, '$$$$'));
    }
    return result;
  };
  return { text: out, hits, restore };
}

// ---- Correção da transcrição ----
// Correção da transcrição pelo glossário: o modelo de fala não conhece os nomes do
// vídeo ("Cuddy" vira "Cutty", "Wilson" vira "Will son"). Para cada termo, procura no
// texto janelas de palavras parecidas (distância de edição pequena) e troca pela grafia
// do termo. Palavras comuns em inglês nunca são trocadas por aproximação, só quando o
// termo composto casa exatamente (aí apenas a capitalização é ajustada).

function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** Distância de Levenshtein com teto (para sair cedo). */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (cur[j]! < rowMin) rowMin = cur[j]!;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

/** Tolerância de erro por tamanho do termo (em caracteres normalizados). */
function tolerance(len: number): number {
  if (len < 4) return 0;
  if (len < 5) return 1;
  if (len < 10) return 2;
  return 3;
}

const SUFFIXES = ['s', 'es', "'s", 'ed', 'ing', 'ly', 'er'];

/** Diferença que é só um sufixo gramatical ("house" → "houses"): não é erro de reconhecimento. */
function isInflection(word: string, term: string): boolean {
  return SUFFIXES.some((suf) => word === term + suf || term === word + suf);
}

interface Word {
  text: string;
  start: number;
  end: number;
}

function words(text: string): Word[] {
  const out: Word[] = [];
  const re = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu;
  for (const m of text.matchAll(re)) out.push({ text: m[0], start: m.index!, end: m.index! + m[0].length });
  return out;
}

/** True se há pontuação de fim de frase entre as palavras ws[i..j] (abreviações como "Dr." não contam). */
function crossesSentence(text: string, ws: Word[], i: number, j: number): boolean {
  for (let k = i; k < j; k++) {
    const w = ws[k]!;
    const low = w.text.toLowerCase();
    const abbrev = HONORIFICS.has(low) || /\p{L}\.\p{L}/u.test(low);
    if (!abbrev && /[.!?;:]$/.test(w.text)) return true;
    if (/[.!?;:]/.test(text.slice(w.end, ws[k + 1]!.start))) return true;
  }
  return false;
}

/**
 * Aplica o glossário ao texto transcrito. Devolve o texto corrigido (ou o mesmo texto).
 * Os termos devem vir do maior para o menor.
 */
export function correctTranscript(text: string, terms: string[]): string {
  if (!text || terms.length === 0) return text;
  let result = text;
  for (const term of terms) {
    const termWords = term.trim().split(/\s+/);
    if (termWords.length === 0 || !termWords[0]) continue;
    const termNorm = norm(term);
    if (termNorm.length < 3) continue;
    const n = termWords.length;
    const tol = tolerance(termNorm.length);
    const termIsCommon = n === 1 && CORE_WORDS.has(termNorm);
    const ws = words(result);
    const edits: { start: number; end: number; replacement: string }[] = [];
    let i = 0;
    while (i + n <= ws.length) {
      const first = ws[i]!;
      const last = ws[i + n - 1]!;
      if (n > 1 && crossesSentence(result, ws, i, i + n - 1)) {
        i++;
        continue;
      }
      const tail = /[.,!?;:'’]+$/.exec(last.text)?.[0] ?? '';
      const window = result.slice(first.start, last.end - tail.length);
      const windowNorm = norm(window);
      let replace = false;
      if (windowNorm === termNorm) {
        // Mesma palavra: só ajusta capitalização, e só em termos compostos (evidência forte)
        // ou quando a grafia difere em algo além de maiúsculas (ex.: "willson" vs "Wilson").
        replace = window !== term && (n > 1 || window.toLowerCase() !== term.toLowerCase());
      } else if (tol > 0 && !termIsCommon) {
        const windowIsCommon = n === 1 && COMMON_WORDS.has(windowNorm);
        if (!windowIsCommon && !isInflection(windowNorm, termNorm) && editDistance(windowNorm, termNorm, tol) <= tol) replace = true;
      }
      if (replace) {
        // A pontuação colada ao fim da última palavra fica ("Cutty," → "Cuddy,").
        edits.push({ start: first.start, end: last.end - tail.length, replacement: term });
        i += n;
      } else i++;
    }
    for (const e of edits.reverse()) result = result.slice(0, e.start) + e.replacement + result.slice(e.end);
  }
  return result;
}
